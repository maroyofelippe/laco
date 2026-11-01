import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/data/lookups_repository.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';
import '../transactions/pickers.dart';
import 'accounts_providers.dart';

PillTone _tone(String s) => switch (s) { 'PAID' => PillTone.good, 'OVERDUE' => PillTone.bad, 'CLOSED' || 'PARTIAL' => PillTone.warn, _ => PillTone.info };

class StatementsScreen extends ConsumerWidget {
  const StatementsScreen({super.key, required this.cardId});
  final String cardId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lk = ref.watch(lookupsProvider).valueOrNull ?? const Lookups();
    final list = ref.watch(statementsProvider(cardId));
    return Scaffold(
      appBar: AppBar(title: Text('Faturas · ${lk.card(cardId)?.name ?? 'Cartão'}'), backgroundColor: LacoColors.fundo),
      body: AsyncBody<List<Map<String, dynamic>>>(
        value: list,
        onRetry: () => ref.invalidate(statementsProvider(cardId)),
        builder: (items) => items.isEmpty
            ? const EmptyState(icon: Icons.credit_card_off_outlined, title: 'Nenhuma fatura ainda')
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final s = items[i];
                  return LacoCard(
                    onTap: () => context.push('/cartao/$cardId/fatura/${s['id']}'),
                    child: Row(children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('Fatura de ${Dates.monthShort('${s['referenceMonth']}')}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text('fecha ${Dates.format('${s['closingDate']}')} · vence ${Dates.format('${s['dueDate']}')}', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
                        ]),
                      ),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(Money.format('${s['totalAmount']}'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 4),
                        StatusPill(statementStatus['${s['status']}'] ?? '${s['status']}', tone: _tone('${s['status']}')),
                      ]),
                    ]),
                  );
                },
              ),
      ),
    );
  }
}

class StatementDetailScreen extends ConsumerWidget {
  const StatementDetailScreen({super.key, required this.cardId, required this.statementId});
  final String cardId;
  final String statementId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(statementProvider((cardId, statementId)));
    final canWrite = ref.watch(currentFamilyProvider)?.canWrite ?? false;
    return Scaffold(
      appBar: AppBar(title: const Text('Fatura'), backgroundColor: LacoColors.fundo),
      body: AsyncBody<Map<String, dynamic>>(
        value: st,
        onRetry: () => ref.invalidate(statementProvider((cardId, statementId))),
        builder: (s) {
          final items = (s['items'] as List? ?? const []).whereType<Map>().toList();
          final remaining = Money.toCents('${s['totalAmount']}') - Money.toCents('${s['paidAmount']}');
          return ListView(padding: const EdgeInsets.all(16), children: [
            LacoCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('Fatura de ${Dates.monthShort('${s['referenceMonth']}')}', style: Theme.of(context).textTheme.titleMedium)),
                  StatusPill(statementStatus['${s['status']}'] ?? '', tone: _tone('${s['status']}')),
                ]),
                const SizedBox(height: 8),
                Text(Money.format('${s['totalAmount']}'), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                Text('Pago ${Money.format('${s['paidAmount']}')} · vence ${Dates.format('${s['dueDate']}')}', style: const TextStyle(color: LacoColors.apoio)),
                if (canWrite && remaining > 0 && s['status'] != 'OPEN') ...[
                  const SizedBox(height: 12),
                  FilledButton.icon(onPressed: () => _pay(context, ref, remaining), icon: const Icon(Icons.check_circle_outline), label: const Text('Registrar pagamento')),
                ],
              ]),
            ),
            SectionTitle('${items.length} lançamento(s)'),
            LacoCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final t in items)
                  ListTile(
                    title: Text('${t['description']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${Dates.format('${t['occurredOn']}')} · ${t['categoryName']}'),
                    trailing: AmountText('${t['amount']}', outflow: t['type'] != 'INCOME', signed: true),
                  ),
              ]),
            ),
          ]);
        },
      ),
    );
  }

  Future<void> _pay(BuildContext context, WidgetRef ref, int remainingCents) async {
    final lk = ref.read(lookupsProvider).valueOrNull ?? const Lookups();
    final amount = TextEditingController(text: Money.toInput(Money.fromCents(remainingCents)));
    Means? account = lk.activeAccounts.isEmpty ? null : Means(accountId: lk.activeAccounts.first.id, name: lk.activeAccounts.first.name);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Registrar pagamento'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: AppTheme.input('Valor pago')),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Pago com a conta'),
              subtitle: Text(account?.name ?? 'Escolher'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                final m = await pickMeans(ctx, lk, allowCards: false);
                if (m != null) setState(() => account = m);
              },
            ),
          ]),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Registrar'))],
        ),
      ),
    );
    final value = Money.parseInput(amount.text);
    if (ok != true || value == null || account == null) return;
    final fam = ref.read(currentFamilyProvider)!;
    try {
      await ref.read(apiClientProvider).post<dynamic>('/families/${fam.id}/cards/$cardId/statements/$statementId/payments', body: {'accountId': account!.accountId, 'amount': value, 'paidOn': Dates.today()});
      ref.invalidate(statementProvider((cardId, statementId)));
      ref.invalidate(statementsProvider(cardId));
      await ref.read(syncProvider.notifier).syncNow();
      if (context.mounted) showSnack(context, 'Pagamento registrado');
    } on ApiException catch (e) {
      if (context.mounted) showSnack(context, e.userMessage, error: true);
    }
  }
}
