import '../db/local_db.dart';
import 'models.dart';

/// Listas de apoio da família (categorias, contas, cartões, membros) guardadas no aparelho
/// e atualizadas pela sincronização. Permitem lançar sem conexão.
class Lookups {
  const Lookups({this.categories = const [], this.accounts = const [], this.cards = const [], this.members = const []});
  final List<Category> categories;
  final List<Account> accounts;
  final List<CardInfo> cards;
  final List<Member> members;

  bool get isEmpty => categories.isEmpty && accounts.isEmpty && cards.isEmpty;

  Category? category(String? id) => id == null ? null : categories.where((c) => c.id == id).firstOrNull;
  Account? account(String? id) => id == null ? null : accounts.where((a) => a.id == id).firstOrNull;
  CardInfo? card(String? id) => id == null ? null : cards.where((c) => c.id == id).firstOrNull;
  Member? member(String? id) => id == null ? null : members.where((m) => m.userId == id).firstOrNull;

  List<Account> get activeAccounts => accounts.where((a) => !a.deleted).toList();
  List<CardInfo> get activeCards => cards.where((c) => !c.deleted).toList();
  List<Member> get activeMembers => members.where((m) => m.active).toList();

  /// Categorias ativas de um tipo, pais seguidos dos filhos.
  List<Category> selectable(String kind) {
    final roots = categories.where((c) => c.kind == kind && c.isActive && c.parentId == null).toList()..sort((a, b) => a.name.compareTo(b.name));
    final out = <Category>[];
    for (final r in roots) {
      out.add(r);
      out.addAll(categories.where((c) => c.parentId == r.id && c.isActive).toList()..sort((a, b) => a.name.compareTo(b.name)));
    }
    return out;
  }

  /// Nome com o pai: "Transporte › Combustível".
  String categoryPath(String id) {
    final c = category(id);
    if (c == null) return '';
    final p = category(c.parentId);
    return p == null ? c.name : '${p.name} › ${c.name}';
  }

  /// A categoria e suas filhas (filtro "Transporte" inclui "Combustível").
  Set<String> withChildren(String id) => {id, ...categories.where((c) => c.parentId == id).map((c) => c.id)};
}

class LookupsRepository {
  LookupsRepository(this._db);
  final LocalDb _db;

  String _k(String familyId, String what) => 'lk:$familyId:$what';

  Future<Lookups> load(String familyId) async {
    List<Map<String, dynamic>> list(dynamic v) => v is List ? v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : const [];
    return Lookups(
      categories: list(await _db.getJson(_k(familyId, 'categories'))).map(Category.fromJson).toList(),
      accounts: list(await _db.getJson(_k(familyId, 'accounts'))).map(Account.fromJson).toList(),
      cards: list(await _db.getJson(_k(familyId, 'cards'))).map(CardInfo.fromJson).toList(),
      members: list(await _db.getJson(_k(familyId, 'members'))).map(Member.fromJson).toList(),
    );
  }

  /// [replace]=true substitui a lista; false mescla por id (sincronização incremental).
  Future<void> save(String familyId, {List<Category>? categories, List<Account>? accounts, List<CardInfo>? cards, List<Member>? members, bool replace = false}) async {
    final current = await load(familyId);
    List<T> merge<T>(List<T> old, List<T> incoming, String Function(T) id) {
      if (replace) return incoming;
      final map = {for (final o in old) id(o): o};
      for (final n in incoming) {
        map[id(n)] = n;
      }
      return map.values.toList();
    }

    if (categories != null) await _db.putJson(_k(familyId, 'categories'), merge(current.categories, categories, (c) => c.id).map((c) => c.toJson()).toList());
    if (cards != null) await _db.putJson(_k(familyId, 'cards'), merge(current.cards, cards, (c) => c.id).map((c) => c.toJson()).toList());
    // Contas e membros sempre chegam completos (saldos mudam a cada lançamento)
    if (accounts != null) await _db.putJson(_k(familyId, 'accounts'), accounts.map((a) => a.toJson()).toList());
    if (members != null) await _db.putJson(_k(familyId, 'members'), members.map((m) => m.toJson()).toList());
  }
}
