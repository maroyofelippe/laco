import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';
import 'accounts_providers.dart';

class AccountsScreen extends ConsumerWidget {
  const AccountsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accounts = ref.watch(accountsProvider);
    final cards = ref.watch(cardsProvider);
    const types = {'CHECKING': 'Conta corrente', 'SAVINGS': 'Poupança', 'CASH': 'Dinheiro'};
    return Scaffold(
      appBar: AppBar(title: const Text('Contas e cartões'), backgroundColor: LacoColors.fundo),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(accountsProvider);
          ref.invalidate(cardsProvider);
        },
        child: ListView(padding: const EdgeInsets.all(16), children: [
          AsyncBody<List<Map<String, dynamic>>>(
            value: accounts,
            onRetry: () => ref.invalidate(accountsProvider),
            builder: (list) {
              final total = list.fold<int>(0, (s, a) => s + Money.toCents('${a['balance'] ?? '0.00'}'));
              return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                LacoCard(
                  color: LacoColors.verde,
                  borderColor: LacoColors.verde,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Saldo nas contas que você vê', style: TextStyle(color: LacoColors.dourado, fontWeight: FontWeight.w700, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(Money.formatCents(total), style: const TextStyle(color: LacoColors.fundo, fontSize: 28, fontWeight: FontWeight.w800)),
                  ]),
                ),
                const SectionTitle('Contas'),
                for (final a in list)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: LacoCard(
                      child: Row(children: [
                        Icon(a['type'] == 'SAVINGS' ? Icons.savings_outlined : Icons.account_balance_outlined, color: LacoColors.verde),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${a['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                            Text('${types[a['type']] ?? a['type']}${a['visibility'] == 'RESTRICTED' ? ' · restrita' : ''}', style: const TextStyle(color: LacoColors.apoio, fontSize: 12)),
                          ]),
                        ),
                        Text(Money.format('${a['balance'] ?? '0.00'}'), style: TextStyle(fontWeight: FontWeight.w800, color: '${a['balance']}'.startsWith('-') ? LacoColors.despesa : LacoColors.tinta)),
                      ]),
                    ),
                  ),
              ]);
            },
          ),
          const SectionTitle('Cartões'),
          AsyncBody<List<Map<String, dynamic>>>(
            value: cards,
            onRetry: () => ref.invalidate(cardsProvider),
            builder: (list) => Column(children: [
              if (list.isEmpty) const LacoCard(child: Text('Nenhum cartão visível para você.', style: TextStyle(color: LacoColors.apoio))),
              for (final c in list) _CardTile(card: c),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _CardTile extends StatelessWidget {
  const _CardTile({required this.card});
  final Map<String, dynamic> card;

  @override
  Widget build(BuildContext context) {
    final limit = Money.toCents('${card['creditLimit']}');
    final used = Money.toCents('${card['usedLimit']}');
    final pct = limit > 0 ? used * 100 / limit : 0;
    final cur = Map<String, dynamic>.from(card['currentStatement'] as Map? ?? const {});
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: LacoCard(
        onTap: () => context.push('/cartao/${card['id']}'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.credit_card, color: LacoColors.verde),
            const SizedBox(width: 10),
            Expanded(child: Text('${card['name']}${card['last4'] != null ? ' · final ${card['last4']}' : ''}', style: const TextStyle(fontWeight: FontWeight.w700))),
            const Icon(Icons.chevron_right, color: LacoColors.apoio),
          ]),
          const SizedBox(height: 12),
          LimitBar(pct: pct, warnAt: 70),
          const SizedBox(height: 6),
          Text('Usado ${Money.format('${card['usedLimit']}')} de ${Money.format('${card['creditLimit']}')} · livre ${Money.format('${card['availableLimit']}')}', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
          const Divider(height: 24),
          Row(children: [
            Expanded(child: Text('Fatura de ${Dates.monthShort('${cur['referenceMonth']}')} · vence ${Dates.format('${cur['dueDate']}')}', style: const TextStyle(fontSize: 13))),
            Text(Money.format('${cur['totalAmount'] ?? '0.00'}'), style: const TextStyle(fontWeight: FontWeight.w800)),
          ]),
        ]),
      ),
    );
  }
}
