import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';
import 'alerts_providers.dart';

class AlertsScreen extends ConsumerWidget {
  const AlertsScreen({super.key});

  Future<void> _markRead(WidgetRef ref, BuildContext context, List<AlertItem> items) async {
    final fam = ref.read(currentFamilyProvider)!;
    try {
      for (final a in items.where((a) => !a.read)) {
        await ref.read(apiClientProvider).post<dynamic>('/families/${fam.id}/alerts/${a.id}/read');
      }
      ref.invalidate(alertsProvider);
    } on ApiException catch (e) {
      if (context.mounted) showSnack(context, e.userMessage, error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(alertsProvider);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Alertas'),
          backgroundColor: LacoColors.fundo,
          actions: [
            if ((data.valueOrNull?.unread ?? 0) > 0)
              TextButton(onPressed: () => _markRead(ref, context, data.value!.active), child: const Text('Marcar como lidos')),
          ],
          bottom: const TabBar(tabs: [Tab(text: 'Ativos'), Tab(text: 'Histórico')], labelColor: LacoColors.verde, indicatorColor: LacoColors.dourado),
        ),
        body: AsyncBody<AlertsData>(
          value: data,
          onRetry: () => ref.invalidate(alertsProvider),
          builder: (d) => TabBarView(children: [
            _AlertList(items: d.active, empty: 'Nenhum alerta por enquanto. O mês está dentro do combinado.', onTap: (a) => _markRead(ref, context, [a])),
            _AlertList(items: d.history, empty: 'Ainda não houve alertas.'),
          ]),
        ),
      ),
    );
  }
}

class _AlertList extends StatelessWidget {
  const _AlertList({required this.items, required this.empty, this.onTap});
  final List<AlertItem> items;
  final String empty;
  final void Function(AlertItem)? onTap;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return EmptyState(icon: Icons.check_circle_outline, title: empty);
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, i) {
        final a = items[i];
        return LacoCard(
          onTap: onTap == null ? null : () => onTap!(a),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: CircleAvatar(radius: 6, backgroundColor: a.status != 'ACTIVE' ? LacoColors.borda : (a.exceeded ? LacoColors.despesa : LacoColors.dourado)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${a.title} · ${a.limitName}', style: TextStyle(fontWeight: a.read || a.status != 'ACTIVE' ? FontWeight.w500 : FontWeight.w800)),
                const SizedBox(height: 2),
                Text('${Money.format(a.consumed)} de ${Money.format(a.limitAmount)} (${a.consumedPct}% no aviso)', style: const TextStyle(fontSize: 13)),
                Text('Período ${Dates.format(a.periodStart)} a ${Dates.format(a.periodEnd)} · ${Dates.dateTime(a.createdAt)}', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
                if (a.status == 'RESOLVED') const Padding(padding: EdgeInsets.only(top: 4), child: StatusPill('Voltou ao combinado', tone: PillTone.good)),
              ]),
            ),
          ]),
        );
      },
    );
  }
}
