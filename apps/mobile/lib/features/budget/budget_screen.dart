import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../core/util/color.dart';
import '../../shared/widgets/common.dart';

final _budgetMonthProvider = StateProvider.autoDispose<DateTime>((ref) => DateTime.now());

final _budgetProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final fam = ref.watch(currentFamilyProvider)!;
  final m = ref.watch(_budgetMonthProvider);
  final ym = Dates.iso(m).substring(0, 7);
  return asMap(await fetchWithCache(ref, 'budget:${fam.id}:$ym', '/families/${fam.id}/budgets', query: {'month': ym}));
});

/// Planejado × realizado do mês. O orçamento é definido no painel web por quem administra.
class BudgetScreen extends ConsumerWidget {
  const BudgetScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final month = ref.watch(_budgetMonthProvider);
    final data = ref.watch(_budgetProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Orçamento'), backgroundColor: LacoColors.fundo),
      body: Column(children: [
        MonthSelector(month: month, onChanged: (m) => ref.read(_budgetMonthProvider.notifier).state = m),
        Expanded(
          child: AsyncBody<Map<String, dynamic>>(
            value: data,
            onRetry: () => ref.invalidate(_budgetProvider),
            builder: (b) {
              final totals = asMap(b['totals']);
              final items = asList(b['items']).where((i) => Money.toCents('${i['planned']}') > 0 || Money.toCents('${i['actual']}') > 0).toList();
              return ListView(padding: const EdgeInsets.all(16), children: [
                LacoCard(
                  child: Row(children: [
                    _Total('Planejado', '${totals['planned']}', LacoColors.tinta),
                    _Total('Já usado', '${totals['actual']}', LacoColors.despesa),
                    _Total('Ainda livre', '${totals['remaining']}', '${totals['remaining']}'.startsWith('-') ? LacoColors.despesa : LacoColors.receita),
                  ]),
                ),
                const SizedBox(height: 12),
                if (items.isEmpty) const EmptyState(icon: Icons.savings_outlined, title: 'Sem orçamento neste mês', message: 'Quem administra a família define o planejado no painel web.'),
                for (final i in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: LacoCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          CircleAvatar(radius: 5, backgroundColor: hexColor(i['color'] as String?)),
                          const SizedBox(width: 8),
                          Expanded(child: Text('${i['name']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                          Text(i['usedPct'] == null ? 'não planejado' : '${(i['usedPct'] as num).round()}%', style: const TextStyle(color: LacoColors.apoio, fontSize: 12)),
                        ]),
                        if (i['usedPct'] != null) ...[const SizedBox(height: 8), LimitBar(pct: i['usedPct'] as num, warnAt: 90)],
                        const SizedBox(height: 6),
                        Text('${Money.format('${i['actual']}')} de ${Money.format('${i['planned']}')}', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
                      ]),
                    ),
                  ),
              ]);
            },
          ),
        ),
      ]),
    );
  }
}

class _Total extends StatelessWidget {
  const _Total(this.label, this.value, this.color);
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(children: [
          Text(label, style: const TextStyle(fontSize: 12, color: LacoColors.apoio, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          FittedBox(child: Text(Money.format(value), style: TextStyle(fontWeight: FontWeight.w800, color: color))),
        ]),
      );
}
