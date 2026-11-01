import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/notifications/notification_service.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/brand.dart';
import '../../shared/widgets/common.dart';
import '../alerts/alerts_providers.dart';
import 'home_providers.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool? _notifGranted;

  @override
  void initState() {
    super.initState();
    NotificationService.isGranted().then((v) {
      if (mounted) setState(() => _notifGranted = v);
    });
  }

  Future<void> _refresh() async {
    await ref.read(syncProvider.notifier).syncNow();
    ref.invalidate(homeProvider);
    ref.invalidate(alertsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final fam = ref.watch(currentFamilyProvider);
    final home = ref.watch(homeProvider);
    final alerts = ref.watch(alertsProvider).valueOrNull;
    final sync = ref.watch(syncProvider);

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              Row(children: [
                const LacoSymbol(size: 32),
                const SizedBox(width: 10),
                Expanded(
                  child: InkWell(
                    onTap: () => context.push('/familias'),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Flexible(child: Text(fam?.name ?? '', overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
                      const Icon(Icons.expand_more, color: LacoColors.apoio),
                    ]),
                  ),
                ),
                _SyncIndicator(status: sync),
                IconButton(
                  tooltip: 'Alertas',
                  onPressed: () => context.push('/alertas'),
                  icon: Badge(isLabelVisible: (alerts?.unread ?? 0) > 0, label: Text('${alerts?.unread ?? 0}'), backgroundColor: LacoColors.dourado, textColor: LacoColors.verde, child: const Icon(Icons.notifications_outlined)),
                ),
              ]),
              const SizedBox(height: 16),
              Text('Como está o mês da família?', style: Theme.of(context).textTheme.headlineSmall),
              Text(Dates.month(DateTime.now()), style: const TextStyle(color: LacoColors.apoio)),
              const SizedBox(height: 16),
              home.when(
                loading: () => const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
                error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(homeProvider)),
                data: (d) => _Summary(data: d),
              ),
              const SizedBox(height: 16),
              _QuickActions(canWrite: fam?.canWrite ?? false),
              if (_notifGranted == false) ...[
                const SizedBox(height: 16),
                LacoCard(
                  color: LacoColors.douradoClaro,
                  borderColor: LacoColors.dourado,
                  child: Row(children: [
                    const Icon(Icons.notifications_active_outlined, color: LacoColors.douradoTexto),
                    const SizedBox(width: 12),
                    const Expanded(child: Text('Quer saber quando um limite estiver chegando perto?', style: TextStyle(color: LacoColors.tinta))),
                    TextButton(
                      onPressed: () async {
                        final ok = await NotificationService.requestWithRationale(context);
                        if (mounted) setState(() => _notifGranted = ok);
                      },
                      child: const Text('Ativar'),
                    ),
                  ]),
                ),
              ],
              if ((alerts?.unread ?? 0) > 0) ...[
                const SizedBox(height: 16),
                LacoCard(
                  onTap: () => context.push('/alertas'),
                  child: Row(children: [
                    const Icon(Icons.flag_outlined, color: LacoColors.douradoTexto),
                    const SizedBox(width: 12),
                    Expanded(child: Text('${alerts!.unread} alerta(s) para ver: ${alerts.active.first.limitName}${alerts.unread > 1 ? ' e outros' : ''}.')),
                    const Icon(Icons.chevron_right, color: LacoColors.apoio),
                  ]),
                ),
              ],
              if (home.valueOrNull != null) ...[
                SectionTitle('Limites combinados', action: 'Ver todos', onAction: () => context.push('/limites')),
                _Limits(items: home.value!.limits),
                SectionTitle('Próximos vencimentos', action: 'Cartões', onAction: () => context.push('/contas')),
                _Upcoming(items: home.value!.upcoming),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _SyncIndicator extends StatelessWidget {
  const _SyncIndicator({required this.status});
  final SyncStatus status;

  @override
  Widget build(BuildContext context) {
    if (status.running) return const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)));
    if (!status.offline && status.pending == 0 && status.failed == 0) return const SizedBox.shrink();
    final (icon, tip) = status.failed > 0
        ? (Icons.sync_problem, '${status.failed} item(ns) não enviado(s)')
        : status.offline
            ? (Icons.cloud_off_outlined, 'Sem conexão: ${status.pending} aguardando envio')
            : (Icons.cloud_upload_outlined, '${status.pending} aguardando envio');
    return IconButton(tooltip: tip, onPressed: () => context.push('/sincronizacao'), icon: Icon(icon, color: status.failed > 0 ? LacoColors.despesa : LacoColors.apoio));
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.data});
  final HomeData data;

  @override
  Widget build(BuildContext context) {
    final s = data.summary;
    final result = '${s['result'] ?? '0.00'}';
    Widget tile(String label, String value, {Color? color, bool highlight = false, String? hint}) => Expanded(
          child: LacoCard(
            color: highlight ? LacoColors.verde : null,
            borderColor: highlight ? LacoColors.verde : null,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: highlight ? LacoColors.dourado : LacoColors.apoio)),
              const SizedBox(height: 4),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(Money.format(value), style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: highlight ? LacoColors.fundo : (color ?? LacoColors.tinta))),
              ),
              if (hint != null) Text(hint, style: TextStyle(fontSize: 11, color: highlight ? LacoColors.verdeBorda : LacoColors.apoio)),
            ]),
          ),
        );
    return Column(children: [
      Row(children: [
        tile('Receitas', '${s['income'] ?? '0.00'}', color: LacoColors.receita),
        const SizedBox(width: 10),
        tile('Despesas', '${s['expense'] ?? '0.00'}', color: LacoColors.despesa),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        tile('Resultado do mês', result, color: result.startsWith('-') ? LacoColors.despesa : LacoColors.receita),
        const SizedBox(width: 10),
        tile('Saldo nas contas', '${s['accountsBalance'] ?? '0.00'}', highlight: true, hint: 'Faturas abertas: ${Money.format('${s['openCardBills'] ?? '0.00'}')}'),
      ]),
    ]);
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.canWrite});
  final bool canWrite;

  @override
  Widget build(BuildContext context) {
    if (!canWrite) return const SizedBox.shrink();
    Widget action(IconData icon, String label, String route) => Expanded(
          child: LacoCard(
            onTap: () => context.push(route),
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
            child: Column(children: [
              Icon(icon, color: LacoColors.verde),
              const SizedBox(height: 6),
              Text(label, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            ]),
          ),
        );
    return Row(children: [
      action(Icons.add_circle_outline, 'Lançar', '/lancamento/novo'),
      const SizedBox(width: 10),
      action(Icons.document_scanner_outlined, 'Nota fiscal', '/nota-fiscal'),
      const SizedBox(width: 10),
      action(Icons.picture_as_pdf_outlined, 'Importar extrato', '/importar'),
    ]);
  }
}

class _Limits extends StatelessWidget {
  const _Limits({required this.items});
  final List<Map<String, dynamic>> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const LacoCard(child: Text('Nenhum limite combinado ainda. Quem administra a família pode combinar limites no painel web.', style: TextStyle(color: LacoColors.apoio)));
    }
    return LacoCard(
      child: Column(children: [
        for (final l in items.take(4)) ...[
          Row(children: [
            Expanded(child: Text('${l['name']}', style: const TextStyle(fontWeight: FontWeight.w700))),
            StatusPill(limitStatusLabels['${l['status']}'] ?? '', tone: toneForLimit('${l['status']}')),
          ]),
          const SizedBox(height: 8),
          LimitBar(pct: (l['consumedPct'] as num?) ?? 0, warnAt: ((l['thresholds'] as List?)?.cast<num>().reduce((a, b) => a < b ? a : b)) ?? 80),
          const SizedBox(height: 4),
          Align(alignment: Alignment.centerLeft, child: Text('${Money.format('${l['consumed']}')} de ${Money.format('${l['amount']}')} · ${l['consumedPct']}%', style: const TextStyle(fontSize: 12, color: LacoColors.apoio))),
          const SizedBox(height: 14),
        ],
      ]),
    );
  }
}

class _Upcoming extends StatelessWidget {
  const _Upcoming({required this.items});
  final List<Map<String, dynamic>> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const LacoCard(child: Text('Nenhuma fatura vencendo nos próximos 45 dias.', style: TextStyle(color: LacoColors.apoio)));
    return LacoCard(
      padding: EdgeInsets.zero,
      child: Column(children: [
        for (final u in items)
          ListTile(
            onTap: () => context.push('/cartao/${u['cardId']}/fatura/${u['id']}'),
            title: Text('Fatura ${u['cardName']} · ${Dates.monthShort('${u['referenceMonth']}')}', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('vence ${Dates.format('${u['dueDate']}')}'),
            trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(Money.formatCents(Money.toCents('${u['totalAmount']}') - Money.toCents('${u['paidAmount']}')), style: const TextStyle(fontWeight: FontWeight.w700)),
              if (u['overdue'] == true) const StatusPill('Vencida', tone: PillTone.bad),
            ]),
          ),
      ]),
    );
  }
}
