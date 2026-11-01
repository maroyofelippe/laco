/// Modelos simples com fromJson/toJson escritos à mão (sem geração de código).
library;

String _s(Object? v) => v == null ? '' : '$v';
String? _ns(Object? v) => v?.toString();
bool _b(Object? v) => v == true || v == 1;
int _i(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;

class UserInfo {
  const UserInfo({required this.id, required this.name, required this.email});
  final String id;
  final String name;
  final String email;
  factory UserInfo.fromJson(Map<String, dynamic> j) => UserInfo(id: _s(j['id']), name: _s(j['name']), email: _s(j['email']));
  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'email': email};
}

class FamilyRef {
  const FamilyRef({required this.id, required this.name, required this.role});
  final String id;
  final String name;
  final String role; // OWNER | ADMIN | MEMBER | VIEWER
  bool get canWrite => role != 'VIEWER';
  bool get isAdmin => role == 'OWNER' || role == 'ADMIN';
  factory FamilyRef.fromJson(Map<String, dynamic> j) => FamilyRef(id: _s(j['id']), name: _s(j['name']), role: _s(j['role'] ?? j['myRole']));
  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'role': role};
}

const roleLabels = {'OWNER': 'Titular', 'ADMIN': 'Administrador(a)', 'MEMBER': 'Membro', 'VIEWER': 'Leitor(a)'};

class Category {
  const Category({required this.id, required this.name, required this.kind, this.parentId, this.color, this.isSystem = false, this.isActive = true});
  final String id;
  final String name;
  final String kind; // INCOME | EXPENSE | TRANSFER
  final String? parentId;
  final String? color;
  final bool isSystem;
  final bool isActive;
  factory Category.fromJson(Map<String, dynamic> j) => Category(
        id: _s(j['id']), name: _s(j['name']), kind: _s(j['kind']), parentId: _ns(j['parentId']), color: _ns(j['color']),
        isSystem: _b(j['isSystem']), isActive: j['isActive'] == null || _b(j['isActive']),
      );
  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'kind': kind, 'parentId': parentId, 'color': color, 'isSystem': isSystem, 'isActive': isActive};
}

class Account {
  const Account({required this.id, required this.type, required this.name, this.balance, this.visibility = 'FAMILY', this.deleted = false});
  final String id;
  final String type; // CHECKING | SAVINGS | CASH
  final String name;
  final String? balance;
  final String visibility;
  final bool deleted;
  String get typeLabel => const {'CHECKING': 'Conta corrente', 'SAVINGS': 'Poupança', 'CASH': 'Dinheiro'}[type] ?? type;
  factory Account.fromJson(Map<String, dynamic> j) => Account(
        id: _s(j['id']), type: _s(j['type']), name: _s(j['name']), balance: _ns(j['balance']), visibility: _s(j['visibility'] ?? 'FAMILY'), deleted: _b(j['deleted']),
      );
  Map<String, dynamic> toJson() => {'id': id, 'type': type, 'name': name, 'balance': balance, 'visibility': visibility, 'deleted': deleted};
}

class CardInfo {
  const CardInfo({required this.id, required this.name, this.brand, this.last4, required this.creditLimit, required this.closingDay, required this.dueDay, this.deleted = false});
  final String id;
  final String name;
  final String? brand;
  final String? last4;
  final String creditLimit;
  final int closingDay;
  final int dueDay;
  final bool deleted;
  factory CardInfo.fromJson(Map<String, dynamic> j) => CardInfo(
        id: _s(j['id']), name: _s(j['name']), brand: _ns(j['brand']), last4: _ns(j['last4']), creditLimit: _s(j['creditLimit'] ?? '0.00'),
        closingDay: _i(j['closingDay']), dueDay: _i(j['dueDay']), deleted: _b(j['deleted']),
      );
  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'brand': brand, 'last4': last4, 'creditLimit': creditLimit, 'closingDay': closingDay, 'dueDay': dueDay, 'deleted': deleted};
}

class Member {
  const Member({required this.userId, required this.name, required this.role, required this.status});
  final String userId;
  final String name;
  final String role;
  final String status;
  bool get active => status == 'ACTIVE';
  factory Member.fromJson(Map<String, dynamic> j) => Member(userId: _s(j['userId']), name: _s(j['name']), role: _s(j['role']), status: _s(j['status'] ?? 'ACTIVE'));
  Map<String, dynamic> toJson() => {'userId': userId, 'name': name, 'role': role, 'status': status};
}

/// Lançamento como guardado no aparelho (formato da API, com nomes já resolvidos).
class Txn {
  const Txn({
    required this.id,
    required this.type,
    required this.amount,
    required this.description,
    required this.occurredOn,
    required this.categoryId,
    this.categoryName = '',
    this.categoryColor,
    this.categoryParentId,
    this.accountId,
    this.accountName,
    this.cardId,
    this.cardName,
    this.memberId,
    this.memberName,
    this.status = 'CLEARED',
    this.source = 'MANUAL',
    this.installmentNumber,
    this.installmentPlanId,
    this.transferGroupId,
    this.statementMonth,
    this.notes,
    this.version = 1,
    this.pending = false,
    this.syncError,
  });

  final String id;
  final String type; // INCOME | EXPENSE | TRANSFER_IN | TRANSFER_OUT | CARD_PAYMENT
  final String amount;
  final String description;
  final String occurredOn;
  final String categoryId;
  final String categoryName;
  final String? categoryColor;
  final String? categoryParentId;
  final String? accountId;
  final String? accountName;
  final String? cardId;
  final String? cardName;
  final String? memberId;
  final String? memberName;
  final String status;
  final String source;
  final int? installmentNumber;
  final String? installmentPlanId;
  final String? transferGroupId;
  final String? statementMonth;
  final String? notes;
  final int version;
  final bool pending; // ainda não confirmado pelo servidor
  final String? syncError;

  bool get isOutflow => type == 'EXPENSE' || type == 'TRANSFER_OUT' || type == 'CARD_PAYMENT';
  bool get isTransfer => transferGroupId != null || type == 'CARD_PAYMENT';
  String get meansName => cardName ?? accountName ?? '';

  factory Txn.fromApi(Map<String, dynamic> j) {
    Map<String, dynamic>? m(String k) => j[k] is Map ? Map<String, dynamic>.from(j[k] as Map) : null;
    final cat = m('category') ?? const {};
    final acc = m('account');
    final card = m('card');
    final member = m('member');
    final inst = m('installment');
    final st = m('statement');
    return Txn(
      id: _s(j['id']), type: _s(j['type']), amount: _s(j['amount']), description: _s(j['description']), occurredOn: _s(j['occurredOn']),
      categoryId: _s(cat['id']), categoryName: _s(cat['name']), categoryColor: _ns(cat['color']), categoryParentId: _ns(cat['parentId']),
      accountId: _ns(acc?['id']), accountName: _ns(acc?['name']), cardId: _ns(card?['id']), cardName: _ns(card?['name']),
      memberId: _ns(member?['id']), memberName: _ns(member?['name']), status: _s(j['status'] ?? 'CLEARED'), source: _s(j['source'] ?? 'MANUAL'),
      installmentNumber: inst == null ? null : _i(inst['number']), installmentPlanId: _ns(inst?['planId']), transferGroupId: _ns(j['transferGroupId']),
      statementMonth: _ns(st?['referenceMonth']), notes: _ns(j['notes']), version: j['version'] == null ? 1 : _i(j['version']),
      pending: _b(j['_pending']), syncError: _ns(j['_syncError']),
    );
  }

  /// Mesmo formato da API (permite guardar e reler sem perda).
  Map<String, dynamic> toApiJson() => {
        'id': id, 'type': type, 'amount': amount, 'description': description, 'occurredOn': occurredOn, 'status': status, 'source': source,
        'category': {'id': categoryId, 'name': categoryName, 'color': categoryColor, 'parentId': categoryParentId},
        'account': accountId == null ? null : {'id': accountId, 'name': accountName},
        'card': cardId == null ? null : {'id': cardId, 'name': cardName},
        'member': memberId == null ? null : {'id': memberId, 'name': memberName},
        'installment': installmentPlanId == null ? null : {'planId': installmentPlanId, 'number': installmentNumber},
        'statement': statementMonth == null ? null : {'referenceMonth': statementMonth},
        'transferGroupId': transferGroupId, 'notes': notes, 'version': version, '_pending': pending, '_syncError': syncError,
      };

  Txn copyWith({String? amount, String? description, String? occurredOn, String? categoryId, String? categoryName, String? categoryColor, String? categoryParentId, int? version, bool? pending, String? syncError, bool clearError = false}) => Txn(
        id: id, type: type, amount: amount ?? this.amount, description: description ?? this.description, occurredOn: occurredOn ?? this.occurredOn,
        categoryId: categoryId ?? this.categoryId, categoryName: categoryName ?? this.categoryName, categoryColor: categoryColor ?? this.categoryColor,
        categoryParentId: categoryParentId ?? this.categoryParentId, accountId: accountId, accountName: accountName, cardId: cardId, cardName: cardName,
        memberId: memberId, memberName: memberName, status: status, source: source, installmentNumber: installmentNumber, installmentPlanId: installmentPlanId,
        transferGroupId: transferGroupId, statementMonth: statementMonth, notes: notes, version: version ?? this.version, pending: pending ?? this.pending,
        syncError: clearError ? null : (syncError ?? this.syncError),
      );
}
