import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/data/lookups_repository.dart';
import '../../core/data/models.dart';
import '../../core/data/transactions_repository.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/color.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';
import 'pickers.dart';
import 'transactions_providers.dart';

class TransactionsScreen extends ConsumerWidget {
  const TransactionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fam = ref.watch(currentFamilyProvider);
    final filter = ref.watch(txnFilterProvider);
    final ctrl = ref.read(txnFilterProvider.notifier);
    final txns = ref.watch(transactionsProvider);
    final lk = ref.watch(lookupsProvider).valueOrNull ?? const Lookups();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Lançamentos'),
        backgroundColor: LacoColors.fundo,
        actions: [
          IconButton(
            tooltip: 'Filtros',
            onPressed: () => _openFilters(context, ref, lk),
            icon: Badge(isLabelVisible: filter.hasExtraFilters && filter.query.isEmpty, smallSize: 8, backgroundColor: LacoColors.dourado, child: const Icon(Icons.tune)),
          ),
        ],
      ),
      floatingActionButton: (fam?.canWrite ?? false)
          ? FloatingActionButton.extended(onPressed: () => context.push('/lancamento/novo'), icon: const Icon(Icons.add), label: const Text('Lançar'))
          : null,
      body: Column(children: [
        MonthSelector(month: ctrl.month, onChanged: ctrl.setMonth),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: TextField(
            onChanged: ctrl.setQuery,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: 'Buscar por descrição, categoria ou conta',
              filled: true,
              fillColor: LacoColors.superficie,
              contentPadding: const EdgeInsets.symmetric(vertical: 10),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: LacoColors.borda)),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: LacoColors.borda)),
            ),
          ),
        ),
        if (filter.hasExtraFilters && filter.query.isEmpty) _ActiveFilters(filter: filter, lk: lk),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async => ref.read(syncProvider.notifier).syncNow(),
            child: AsyncBody<List<Txn>>(
              value: txns,
              onRetry: () => ref.invalidate(transactionsProvider),
              builder: (list) => list.isEmpty
                  ? ListView(children: const [
                      SizedBox(height: 60),
                      EmptyState(icon: Icons.receipt_long_outlined, title: 'Nada por aqui neste mês', message: 'Lance uma despesa, fotografe uma nota ou importe um extrato.'),
                    ])
                  : _GroupedList(list: list),
            ),
          ),
        ),
      ]),
    );
  }

  Future<void> _openFilters(BuildContext context, WidgetRef ref, Lookups lk) async {
    final result = await showModalBottomSheet<TxnFilter>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      backgroundColor: LacoColors.fundo,
      builder: (_) => _FilterSheet(initial: ref.read(txnFilterProvider), lk: lk),
    );
    if (result != null) ref.read(txnFilterProvider.notifier).set(result);
  }
}

class _ActiveFilters extends ConsumerWidget {
  const _ActiveFilters({required this.filter, required this.lk});
  final TxnFilter filter;
  final Lookups lk;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final labels = <String>[
      if (filter.type != null) const {'INCOME': 'Receitas', 'EXPENSE': 'Despesas', 'TRANSFER': 'Transferências'}[filter.type]!,
      if (filter.categoryId != null) lk.categoryPath(filter.categoryId!),
      if (filter.accountId != null) lk.account(filter.accountId)?.name ?? 'Conta',
      if (filter.cardId != null) lk.card(filter.cardId)?.name ?? 'Cartão',
      if (filter.memberId != null) lk.member(filter.memberId)?.name ?? 'Membro',
    ];
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          for (final l in labels) Padding(padding: const EdgeInsets.only(right: 6), child: Chip(label: Text(l), backgroundColor: LacoColors.verdeClaro, side: BorderSide.none)),
          ActionChip(label: const Text('Limpar'), onPressed: () => ref.read(txnFilterProvider.notifier).clearExtras()),
        ],
      ),
    );
  }
}

class _GroupedList extends StatelessWidget {
  const _GroupedList({required this.list});
  final List<Txn> list;

  @override
  Widget build(BuildContext context) {
    final byDay = <String, List<Txn>>{};
    for (final t in list) {
      byDay.putIfAbsent(t.occurredOn, () => []).add(t);
    }
    final income = list.where((t) => t.type == 'INCOME').fold<int>(0, (s, t) => s + Money.toCents(t.amount));
    final expense = list.where((t) => t.type == 'EXPENSE').fold<int>(0, (s, t) => s + Money.toCents(t.amount));
    final days = byDay.keys.toList();
    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 96),
      itemCount: days.length + 1,
      itemBuilder: (context, i) {
        if (i == 0) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: Row(children: [
              Expanded(child: Text('Entrou ${Money.formatCents(income)}', style: const TextStyle(color: LacoColors.receita, fontWeight: FontWeight.w700))),
              Text('Saiu ${Money.formatCents(expense)}', style: const TextStyle(color: LacoColors.despesa, fontWeight: FontWeight.w700)),
            ]),
          );
        }
        final day = days[i - 1];
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 6), child: Text(Dates.weekday(day), style: const TextStyle(color: LacoColors.apoio, fontWeight: FontWeight.w700, fontSize: 13))),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: LacoCard(
              padding: EdgeInsets.zero,
              child: Column(children: [for (final t in byDay[day]!) TxnTile(txn: t)]),
            ),
          ),
        ]);
      },
    );
  }
}

class TxnTile extends StatelessWidget {
  const TxnTile({super.key, required this.txn});
  final Txn txn;

  @override
  Widget build(BuildContext context) {
    final t = txn;
    final sub = <String>[t.categoryName, t.meansName, if (t.memberName != null) t.memberName!].where((s) => s.isNotEmpty).join(' · ');
    return ListTile(
      onTap: () => context.push('/lancamento/${t.id}'),
      leading: CircleAvatar(
        backgroundColor: hexColor(t.categoryColor).withValues(alpha: 0.15),
        child: Icon(t.isTransfer ? Icons.swap_horiz : (t.cardId != null ? Icons.credit_card : Icons.receipt_outlined), color: hexColor(t.categoryColor), size: 20),
      ),
      title: Text(t.description, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis),
        if (t.syncError != null)
          const Text('Não enviado: toque para ver', style: TextStyle(color: LacoColors.despesa, fontSize: 12, fontWeight: FontWeight.w700))
        else if (t.pending)
          const Text('Aguardando envio', style: TextStyle(color: LacoColors.douradoTexto, fontSize: 12, fontWeight: FontWeight.w700))
        else if (t.occurredOn.compareTo(Dates.today()) > 0)
          const Text('Agendado', style: TextStyle(color: LacoColors.apoio, fontSize: 12)),
      ]),
      trailing: AmountText(t.amount, outflow: t.isOutflow, signed: true),
    );
  }
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.initial, required this.lk});
  final TxnFilter initial;
  final Lookups lk;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late TxnFilter f = widget.initial;

  @override
  Widget build(BuildContext context) {
    final lk = widget.lk;
    Widget row(String label, String value, VoidCallback onTap, VoidCallback? onClear) => ListTile(
          title: Text(label, style: const TextStyle(color: LacoColors.apoio, fontSize: 13)),
          subtitle: Text(value, style: const TextStyle(fontWeight: FontWeight.w700, color: LacoColors.tinta, fontSize: 15)),
          trailing: onClear == null ? const Icon(Icons.chevron_right) : IconButton(onPressed: onClear, icon: const Icon(Icons.close)),
          onTap: onTap,
        );
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('Filtrar lançamentos', style: Theme.of(context).textTheme.titleLarge)),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SegmentedButton<String>(
              segments: const [ButtonSegment(value: 'ALL', label: Text('Todos')), ButtonSegment(value: 'EXPENSE', label: Text('Despesas')), ButtonSegment(value: 'INCOME', label: Text('Receitas')), ButtonSegment(value: 'TRANSFER', label: Text('Transf.'))],
              selected: {f.type ?? 'ALL'},
              onSelectionChanged: (s) => setState(() => f = s.first == 'ALL' ? f.copyWith(clearType: true) : f.copyWith(type: s.first)),
            ),
          ),
          row('Categoria', f.categoryId == null ? 'Todas' : lk.categoryPath(f.categoryId!), () async {
            final c = await pickCategory(context, lk, f.type == 'INCOME' ? 'INCOME' : 'EXPENSE');
            if (c != null) setState(() => f = f.copyWith(categoryId: c.id));
          }, f.categoryId == null ? null : () => setState(() => f = f.copyWith(clearCategory: true))),
          row('Conta ou cartão', lk.account(f.accountId)?.name ?? lk.card(f.cardId)?.name ?? 'Todos', () async {
            final m = await pickMeans(context, lk);
            if (m != null) setState(() => f = f.copyWith(clearMeans: true).copyWith(accountId: m.accountId, cardId: m.cardId));
          }, (f.accountId ?? f.cardId) == null ? null : () => setState(() => f = f.copyWith(clearMeans: true))),
          row('Pessoa', lk.member(f.memberId)?.name ?? 'Todas', () async {
            final m = await pickMember(context, lk);
            if (m != null) setState(() => f = f.copyWith(memberId: m.userId));
          }, f.memberId == null ? null : () => setState(() => f = f.copyWith(clearMember: true))),
          const SizedBox(height: 12),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: FilledButton(onPressed: () => Navigator.pop(context, f), child: const Text('Aplicar filtros'))),
        ]),
      ),
    );
  }
}
