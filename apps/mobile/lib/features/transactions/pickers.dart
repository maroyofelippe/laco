import 'package:flutter/material.dart';

import '../../core/data/lookups_repository.dart';
import '../../core/data/models.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/color.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';

/// Conta ou cartão escolhido no formulário.
class Means {
  const Means({this.accountId, this.cardId, required this.name});
  final String? accountId;
  final String? cardId;
  final String name;
  bool get isCard => cardId != null;
}

Future<Category?> pickCategory(BuildContext context, Lookups lk, String kind) => showPickerSheet<Category>(
      context,
      title: kind == 'INCOME' ? 'Categoria da receita' : 'Categoria da despesa',
      items: lk.selectable(kind),
      label: (c) => c.name,
      indented: (c) => c.parentId != null,
      leading: (c) => CircleAvatar(radius: 6, backgroundColor: hexColor(c.color ?? lk.category(c.parentId)?.color)),
      searchable: true,
    );

Future<Means?> pickMeans(BuildContext context, Lookups lk, {bool allowCards = true}) {
  final items = <Means>[
    for (final a in lk.activeAccounts) Means(accountId: a.id, name: a.name),
    if (allowCards)
      for (final c in lk.activeCards) Means(cardId: c.id, name: c.name),
  ];
  return showPickerSheet<Means>(
    context,
    title: 'Conta ou cartão',
    items: items,
    label: (m) => m.name,
    subtitle: (m) {
      if (m.isCard) {
        final c = lk.card(m.cardId)!;
        return 'Cartão${c.last4 != null ? ' · final ${c.last4}' : ''} · fecha dia ${c.closingDay}';
      }
      final a = lk.account(m.accountId)!;
      return '${a.typeLabel}${a.balance != null ? ' · saldo ${Money.format(a.balance)}' : ''}';
    },
    leading: (m) => Icon(m.isCard ? Icons.credit_card : Icons.account_balance_outlined, color: LacoColors.verde),
  );
}

Future<Member?> pickMember(BuildContext context, Lookups lk) => showPickerSheet<Member>(
      context,
      title: 'Quem fez este lançamento?',
      items: lk.activeMembers,
      label: (m) => m.name,
      subtitle: (m) => roleLabels[m.role] ?? m.role,
      leading: (m) => CircleAvatar(backgroundColor: LacoColors.verdeClaro, child: Text(m.name.isEmpty ? '?' : m.name[0].toUpperCase(), style: const TextStyle(color: LacoColors.verde, fontWeight: FontWeight.w700))),
    );
