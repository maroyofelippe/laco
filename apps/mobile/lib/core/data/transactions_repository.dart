import 'dart:convert';

import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import '../db/local_db.dart';
import '../sync/outbox.dart';
import '../util/money.dart';
import '../util/text.dart';
import 'lookups_repository.dart';
import 'models.dart';

class TxnFilter {
  const TxnFilter({required this.from, required this.to, this.type, this.categoryId, this.accountId, this.cardId, this.memberId, this.query = ''});
  final String from;
  final String to;
  final String? type; // INCOME | EXPENSE | TRANSFER
  final String? categoryId;
  final String? accountId;
  final String? cardId;
  final String? memberId;
  final String query;

  bool get hasExtraFilters => type != null || categoryId != null || accountId != null || cardId != null || memberId != null || query.isNotEmpty;

  TxnFilter copyWith({String? from, String? to, String? type, String? categoryId, String? accountId, String? cardId, String? memberId, String? query, bool clearType = false, bool clearCategory = false, bool clearMeans = false, bool clearMember = false}) => TxnFilter(
        from: from ?? this.from, to: to ?? this.to, type: clearType ? null : (type ?? this.type),
        categoryId: clearCategory ? null : (categoryId ?? this.categoryId),
        accountId: clearMeans ? null : (accountId ?? this.accountId), cardId: clearMeans ? null : (cardId ?? this.cardId),
        memberId: clearMember ? null : (memberId ?? this.memberId), query: query ?? this.query,
      );
}

/// Dados de um lançamento novo (formulário, nota fiscal ou importação manual).
class TxnDraft {
  const TxnDraft({
    required this.type,
    required this.amount,
    required this.description,
    required this.categoryId,
    required this.occurredOn,
    this.accountId,
    this.cardId,
    this.memberId,
    this.notes,
    this.source = 'MANUAL',
  });
  final String type; // INCOME | EXPENSE
  final String amount; // "125.90"
  final String description;
  final String categoryId;
  final String occurredOn;
  final String? accountId;
  final String? cardId;
  final String? memberId;
  final String? notes;
  final String source; // MANUAL | RECEIPT_OCR
}

/// Lançamentos com escrita "otimista": aparecem na hora no aparelho (marcados como
/// aguardando envio) e entram na fila; a sincronização confirma com o servidor.
class TransactionsRepository {
  TransactionsRepository(this._db, this._outbox, this._lookups);
  final LocalDb _db;
  final Outbox _outbox;
  final LookupsRepository _lookups;
  static const _uuid = Uuid();

  // ---------------------------------------------------------------- leitura
  Future<List<Txn>> list(String familyId, TxnFilter f) async {
    final where = StringBuffer('family_id = ? AND occurred_on >= ? AND occurred_on <= ?');
    final args = <Object?>[familyId, f.from, f.to];
    final q = normalizeText(f.query);
    if (q.isNotEmpty) {
      where.write(' AND search LIKE ?');
      args.add('%${q.replaceAll('%', '').replaceAll('_', '')}%');
    }
    final rows = await _db.db.query('transactions', columns: ['json'], where: where.toString(), whereArgs: args, orderBy: 'occurred_on DESC, id DESC');
    var list = rows.map((r) => Txn.fromApi(Map<String, dynamic>.from(jsonDecode(r['json'] as String) as Map))).toList();
    if (f.type == 'TRANSFER') {
      list = list.where((t) => t.isTransfer).toList();
    } else if (f.type != null) {
      list = list.where((t) => t.type == f.type).toList();
    }
    if (f.categoryId != null) {
      final lk = await _lookups.load(familyId);
      final ids = lk.withChildren(f.categoryId!);
      list = list.where((t) => ids.contains(t.categoryId)).toList();
    }
    if (f.accountId != null) list = list.where((t) => t.accountId == f.accountId).toList();
    if (f.cardId != null) list = list.where((t) => t.cardId == f.cardId).toList();
    if (f.memberId != null) list = list.where((t) => t.memberId == f.memberId).toList();
    return list;
  }

  Future<Txn?> get(String id) async {
    final rows = await _db.db.query('transactions', columns: ['json'], where: 'id = ?', whereArgs: [id], limit: 1);
    return rows.isEmpty ? null : Txn.fromApi(Map<String, dynamic>.from(jsonDecode(rows.first['json'] as String) as Map));
  }

  // ---------------------------------------------------------------- escrita local
  Future<void> upsertLocal(String familyId, Txn t, {DatabaseExecutor? exec}) async {
    final e = exec ?? _db.db;
    await e.insert(
      'transactions',
      {'id': t.id, 'family_id': familyId, 'occurred_on': t.occurredOn, 'search': normalizeText('${t.description} ${t.categoryName} ${t.meansName}'), 'pending': t.pending ? 1 : 0, 'json': jsonEncode(t.toApiJson())},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> deleteLocal(String id, {DatabaseExecutor? exec}) => (exec ?? _db.db).delete('transactions', where: 'id = ?', whereArgs: [id]);

  Future<void> deletePendingPlaceholders(String planId) async {
    final rows = await _db.db.query('transactions', columns: ['id', 'json'], where: 'pending = 1');
    for (final r in rows) {
      final t = Txn.fromApi(Map<String, dynamic>.from(jsonDecode(r['json'] as String) as Map));
      if (t.installmentPlanId == planId) await deleteLocal(t.id);
    }
  }

  Txn _fromDraft(String id, TxnDraft d, Lookups lk, {String? planId, int? number, String? description, String? amount, String? date}) {
    final cat = lk.category(d.categoryId);
    return Txn(
      id: id, type: d.type, amount: amount ?? d.amount, description: description ?? d.description, occurredOn: date ?? d.occurredOn,
      categoryId: d.categoryId, categoryName: cat?.name ?? '', categoryColor: cat?.color, categoryParentId: cat?.parentId,
      accountId: d.accountId, accountName: lk.account(d.accountId)?.name, cardId: d.cardId, cardName: lk.card(d.cardId)?.name,
      memberId: d.memberId, memberName: lk.member(d.memberId)?.name, source: d.source, installmentPlanId: planId, installmentNumber: number,
      notes: d.notes, pending: true, status: (date ?? d.occurredOn).compareTo(_today()) > 0 ? 'PENDING' : 'CLEARED',
    );
  }

  Map<String, dynamic> _body(TxnDraft d) => {
        'type': d.type, 'amount': d.amount, 'description': d.description, 'categoryId': d.categoryId, 'occurredOn': d.occurredOn,
        if (d.accountId != null) 'accountId': d.accountId, if (d.cardId != null) 'cardId': d.cardId,
        if (d.memberId != null) 'memberUserId': d.memberId, if (d.notes != null && d.notes!.isNotEmpty) 'notes': d.notes, 'source': d.source,
      };

  Future<Txn> create(String familyId, TxnDraft d) async {
    final lk = await _lookups.load(familyId);
    final id = _uuid.v7(); // gerado no aparelho: o mesmo id vai para o servidor
    final t = _fromDraft(id, d, lk);
    await upsertLocal(familyId, t);
    await _outbox.add(OutboxEntry(familyId: familyId, kind: 'TX_CREATE', method: 'POST', path: '/families/$familyId/transactions', body: {..._body(d), 'id': id}, localTxId: id, label: 'Lançamento "${d.description}"'));
    return t;
  }

  /// Compra parcelada: mostra as parcelas na hora (mesma divisão da API: centavos na 1ª).
  Future<void> createInstallments(String familyId, TxnDraft d, int count) async {
    final lk = await _lookups.load(familyId);
    final planId = _uuid.v7();
    final total = Money.toCents(d.amount);
    final base = total ~/ count;
    final first = total - base * (count - 1);
    final start = DateTime.parse(d.occurredOn);
    for (var i = 0; i < count; i++) {
      final dt = DateTime(start.year, start.month + i, 1);
      final lastDay = DateTime(dt.year, dt.month + 1, 0).day;
      final date = DateTime(dt.year, dt.month, start.day > lastDay ? lastDay : start.day);
      await upsertLocal(familyId, _fromDraft(_uuid.v7(), d, lk, planId: planId, number: i + 1, description: '${d.description} ${i + 1}/$count', amount: Money.fromCents(i == 0 ? first : base), date: _iso(date)));
    }
    final body = _body(d)
      ..remove('type')
      ..remove('amount')
      ..remove('source')
      ..remove('notes')
      ..addAll({'id': planId, 'totalAmount': d.amount, 'installments': count, 'firstDate': d.occurredOn});
    body.remove('occurredOn');
    await _outbox.add(OutboxEntry(familyId: familyId, kind: 'TX_INSTALLMENTS', method: 'POST', path: '/families/$familyId/transactions/installments', body: body, localTxId: planId, label: 'Compra parcelada "${d.description}" em ${count}x'));
  }

  /// Recorrência: a API gera as ocorrências; o aparelho recebe na próxima sincronização.
  Future<void> createRecurrence(String familyId, TxnDraft d, {required String frequency, String? endDate}) async {
    final body = _body(d)
      ..remove('source')
      ..remove('notes')
      ..remove('occurredOn')
      ..addAll({'frequency': frequency, 'startDate': d.occurredOn, if (endDate != null) 'endDate': endDate});
    await _outbox.add(OutboxEntry(familyId: familyId, kind: 'RECURRENCE_CREATE', method: 'POST', path: '/families/$familyId/recurrences', body: body, label: 'Lançamento recorrente "${d.description}"'));
  }

  /// Edição. Lançamento ainda não enviado: ajusta o pedido na fila. Já enviado: PATCH com If-Match.
  Future<void> update(String familyId, Txn current, {String? amount, String? description, String? categoryId, String? occurredOn, String scope = 'this'}) async {
    final lk = await _lookups.load(familyId);
    final cat = categoryId == null ? null : lk.category(categoryId);
    final updated = current.copyWith(amount: amount, description: description, occurredOn: occurredOn, categoryId: categoryId, categoryName: cat?.name, categoryColor: cat?.color, categoryParentId: cat?.parentId, pending: true, clearError: true);
    await upsertLocal(familyId, updated);

    final queued = await _outbox.pendingCreateFor(current.id);
    if (queued != null) {
      final body = Map<String, dynamic>.from(queued.body ?? {});
      if (amount != null) body['amount'] = amount;
      if (description != null) body['description'] = description;
      if (categoryId != null) body['categoryId'] = categoryId;
      if (occurredOn != null) body['occurredOn'] = occurredOn;
      await _outbox.updateBody(queued.id, body);
      return;
    }
    await _outbox.add(OutboxEntry(
      familyId: familyId, kind: 'TX_UPDATE', method: 'PATCH', path: '/families/$familyId/transactions/${current.id}?scope=$scope',
      headers: {'If-Match': '${current.version}'}, localTxId: current.id, label: 'Alteração em "${current.description}"',
      body: {if (amount != null) 'amount': amount, if (description != null) 'description': description, if (categoryId != null) 'categoryId': categoryId, if (occurredOn != null) 'occurredOn': occurredOn},
    ));
  }

  Future<void> delete(String familyId, Txn t, {String scope = 'this'}) async {
    final queued = await _outbox.pendingCreateFor(t.id);
    await deleteLocal(t.id);
    if (queued != null) {
      await _outbox.remove(queued.id); // nunca chegou ao servidor
      return;
    }
    await _outbox.add(OutboxEntry(familyId: familyId, kind: 'TX_DELETE', method: 'DELETE', path: '/families/$familyId/transactions/${t.id}?scope=$scope', localTxId: t.id, label: 'Exclusão de "${t.description}"'));
  }

  /// Foto da nota anexada ao lançamento (enviada quando houver conexão).
  Future<void> queueAttachment(String familyId, String txId, String filePath) => _outbox.add(OutboxEntry(
        familyId: familyId, kind: 'ATTACHMENT', method: 'POST', path: '/families/$familyId/transactions/$txId/attachments', filePath: filePath, localTxId: txId, label: 'Foto da nota fiscal',
      ));

  static String _today() => _iso(DateTime.now());
  static String _iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
