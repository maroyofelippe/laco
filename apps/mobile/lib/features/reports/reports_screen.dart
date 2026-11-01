import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/lookups_repository.dart';
import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/color.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';
import '../transactions/pickers.dart';

class ReportFilter {
  const ReportFilter({required this.preset, required this.from, required this.to, this.categoryId, this.memberId, this.accountId, this.cardId});
  final String preset; // mes | anterior | trimestre | ano
  final String from;
  final String to;
  final String? categoryId;
  final String? memberId;
  final String? accountId;
  final String? cardId;

  static ReportFilter forPreset(String p, {ReportFilter? keep}) {
    final now = DateTime.now();
    final (DateTime f, DateTime t) = switch (p) {
      'anterior' => (Dates.monthStart(Dates.addMonths(now, -1)), Dates.monthEnd(Dates.addMonths(now, -1))),
      'trimestre' => (Dates.monthStart(Dates.addMonths(now, -2)), Dates.monthEnd(now)),
      'ano' => (DateTime(now.year), DateTime(now.year, 12, 31)),
      _ => (Dates.monthStart(now), Dates.monthEnd(now)),
    };
    return ReportFilter(preset: p, from: Dates.iso(f), to: Dates.iso(t), categoryId: keep?.categoryId, memberId: keep?.memberId, accountId: keep?.accountId, cardId: keep?.cardId);
  }

  Map<String, Object?> get query => {'from': from, 'to': to, 'categoryId': categoryId, 'memberId': memberId, 'accountId': accountId, 'cardId': cardId};

  ReportFilter copyWith({String? categoryId, String? memberId, String? accountId, String? cardId, bool clear = false}) => ReportFilter(
        preset: preset, from: from, to: to,
        categoryId: clear ? null : (categoryId ?? this.categoryId), memberId: clear ? null : (memberId ?? this.memberId),
        accountId: clear ? null : (accountId ?? this.accountId), cardId: clear ? null : (cardId ?? this.cardId),
      );
}

final _reportFilterProvider = StateProvider.autoDispose<ReportFilter>((ref) => ReportFilter.forPreset('mes'));

class ReportData {
  const ReportData(this.summary, this.byCategory, this.byMember, this.series);
  final Map<String, dynamic> summary;
  final List<Map<String, dynamic>> byCategory;
  final List<Map<String, dynamic>> byMember;
  final List<Map<String, dynamic>> series;
}

final _reportProvider = FutureProvider.autoDispose<ReportData>((ref) async {
  final fam = ref.watch(currentFamilyProvider)!;
  final f = ref.watch(_reportFilterProvider);
  final base = '/families/${fam.id}/dashboard';
  final key = 'report:${fam.id}:${f.query.values.join('|')}';
  final r = await Future.wait([
    fetchWithCache(ref, '$key:s', '$base/summary', query: f.query),
    fetchWithCache(ref, '$key:c', '$base/by-category', query: f.query),
    fetchWithCache(ref, '$key:m', '$base/by-member', query: f.query),
    fetchWithCache(ref, '$key:t', '$base/timeseries', query: {...f.query, 'months': 12}),
  ]);
  return ReportData(asMap(r[0]), asList(asMap(r[1])['items']), asList(asMap(r[2])['items']), asList(asMap(r[3])['series']));
});

class ReportsScreen extends ConsumerWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(_reportFilterProvider);
    final data = ref.watch(_reportProvider);
    final lk = ref.watch(lookupsProvider).valueOrNull ?? const Lookups();
    void set(ReportFilter nf) => ref.read(_reportFilterProvider.notifier).state = nf;

    return Scaffold(
      appBar: AppBar(title: const Text('Relatórios'), backgroundColor: LacoColors.fundo),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(_reportProvider),
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 32), children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final p in const [('mes', 'Este mês'), ('anterior', 'Mês passado'), ('trimestre', '3 meses'), ('ano', 'Este ano')])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(label: Text(p.$2), selected: f.preset == p.$1, selectedColor: LacoColors.verdeClaro, onSelected: (_) => set(ReportFilter.forPreset(p.$1, keep: f))),
                ),
            ]),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              _FilterChip(label: f.categoryId == null ? 'Categoria' : lk.categoryPath(f.categoryId!), active: f.categoryId != null, onTap: () async {
                final c = await pickCategory(context, lk, 'EXPENSE');
                if (c != null) set(f.copyWith(categoryId: c.id));
              }),
              _FilterChip(label: lk.member(f.memberId)?.name ?? 'Pessoa', active: f.memberId != null, onTap: () async {
                final m = await pickMember(context, lk);
                if (m != null) set(f.copyWith(memberId: m.userId));
              }),
              _FilterChip(label: lk.account(f.accountId)?.name ?? lk.card(f.cardId)?.name ?? 'Conta ou cartão', active: f.accountId != null || f.cardId != null, onTap: () async {
                final m = await pickMeans(context, lk);
                if (m != null) set(ReportFilter(preset: f.preset, from: f.from, to: f.to, categoryId: f.categoryId, memberId: f.memberId, accountId: m.accountId, cardId: m.cardId));
              }),
              if (f.categoryId != null || f.memberId != null || f.accountId != null || f.cardId != null) TextButton(onPressed: () => set(f.copyWith(clear: true)), child: const Text('Limpar')),
            ]),
          ),
          Text('${Dates.format(f.from)} a ${Dates.format(f.to)}', style: const TextStyle(color: LacoColors.apoio)),
          const SizedBox(height: 8),
          AsyncBody<ReportData>(
            value: data,
            onRetry: () => ref.invalidate(_reportProvider),
            builder: (d) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              LacoCard(
                child: Row(children: [
                  _Num('Receitas', '${d.summary['income']}', LacoColors.receita),
                  _Num('Despesas', '${d.summary['expense']}', LacoColors.despesa),
                  _Num('Resultado', '${d.summary['result']}', '${d.summary['result']}'.startsWith('-') ? LacoColors.despesa : LacoColors.receita),
                ]),
              ),
              const SectionTitle('Para onde foi o dinheiro'),
              _CategoryChart(items: d.byCategory),
              const SectionTitle('Entrou e saiu · 12 meses'),
              _SeriesChart(series: d.series),
              const SectionTitle('Gastos por pessoa'),
              _MemberBars(items: d.byMember),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, required this.active, required this.onTap});
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 6),
        child: ActionChip(
          avatar: Icon(active ? Icons.check : Icons.add, size: 16, color: LacoColors.verde),
          label: Text(label),
          backgroundColor: active ? LacoColors.verdeClaro : LacoColors.superficie,
          side: const BorderSide(color: LacoColors.borda),
          onPressed: onTap,
        ),
      );
}

class _Num extends StatelessWidget {
  const _Num(this.label, this.value, this.color);
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(children: [
          Text(label, style: const TextStyle(fontSize: 12, color: LacoColors.apoio, fontWeight: FontWeight.w700)),
          FittedBox(child: Text(Money.format(value), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: color))),
        ]),
      );
}

class _CategoryChart extends StatelessWidget {
  const _CategoryChart({required this.items});
  final List<Map<String, dynamic>> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const LacoCard(child: Text('Sem despesas no período.', style: TextStyle(color: LacoColors.apoio)));
    final top = items.take(8).toList();
    return LacoCard(
      child: Column(children: [
        SizedBox(
          height: 180,
          child: PieChart(PieChartData(
            sectionsSpace: 2,
            centerSpaceRadius: 50,
            sections: [
              for (final c in top)
                PieChartSectionData(value: Money.toCents('${c['amount']}') / 100, color: hexColor(c['color'] as String?), radius: 32, showTitle: false),
            ],
          )),
        ),
        const SizedBox(height: 12),
        for (final c in top)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(children: [
              CircleAvatar(radius: 5, backgroundColor: hexColor(c['color'] as String?)),
              const SizedBox(width: 8),
              Expanded(child: Text('${c['name']}', overflow: TextOverflow.ellipsis)),
              Text(Money.format('${c['amount']}'), style: const TextStyle(fontWeight: FontWeight.w700)),
              SizedBox(width: 52, child: Text('${c['pct']}%', textAlign: TextAlign.right, style: const TextStyle(color: LacoColors.apoio, fontSize: 12))),
            ]),
          ),
      ]),
    );
  }
}

class _SeriesChart extends StatelessWidget {
  const _SeriesChart({required this.series});
  final List<Map<String, dynamic>> series;

  @override
  Widget build(BuildContext context) {
    if (series.isEmpty) return const SizedBox.shrink();
    final values = [for (final s in series) ...[Money.toCents('${s['income']}') / 100, Money.toCents('${s['expense']}') / 100]];
    final maxY = values.fold<double>(0, (m, v) => v > m ? v : m);
    return LacoCard(
      child: Column(children: [
        SizedBox(
          height: 200,
          child: BarChart(BarChartData(
            maxY: maxY <= 0 ? 1 : maxY * 1.15,
            alignment: BarChartAlignment.spaceAround,
            gridData: const FlGridData(show: false),
            borderData: FlBorderData(show: false),
            titlesData: FlTitlesData(
              leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 22,
                  getTitlesWidget: (value, meta) {
                    final i = value.toInt();
                    if (i < 0 || i >= series.length || i % 2 == 1) return const SizedBox.shrink();
                    return Padding(padding: const EdgeInsets.only(top: 4), child: Text(Dates.monthShort('${series[i]['month']}'), style: const TextStyle(fontSize: 10, color: LacoColors.apoio)));
                  },
                ),
              ),
            ),
            barGroups: [
              for (var i = 0; i < series.length; i++)
                BarChartGroupData(x: i, barsSpace: 2, barRods: [
                  BarChartRodData(toY: Money.toCents('${series[i]['income']}') / 100, color: LacoColors.receita, width: 6, borderRadius: BorderRadius.circular(2)),
                  BarChartRodData(toY: Money.toCents('${series[i]['expense']}') / 100, color: const Color(0xFFB5643F), width: 6, borderRadius: BorderRadius.circular(2)),
                ]),
            ],
          )),
        ),
        const SizedBox(height: 8),
        const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          CircleAvatar(radius: 5, backgroundColor: LacoColors.receita),
          SizedBox(width: 4),
          Text('Receitas', style: TextStyle(fontSize: 12)),
          SizedBox(width: 16),
          CircleAvatar(radius: 5, backgroundColor: Color(0xFFB5643F)),
          SizedBox(width: 4),
          Text('Despesas', style: TextStyle(fontSize: 12)),
        ]),
      ]),
    );
  }
}

class _MemberBars extends StatelessWidget {
  const _MemberBars({required this.items});
  final List<Map<String, dynamic>> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const LacoCard(child: Text('Sem gastos no período.', style: TextStyle(color: LacoColors.apoio)));
    final max = items.fold<int>(0, (m, i) => Money.toCents('${i['expense']}') > m ? Money.toCents('${i['expense']}') : m);
    return LacoCard(
      child: Column(children: [
        for (final m in items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('${m['name']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                Text(Money.format('${m['expense']}')),
              ]),
              const SizedBox(height: 4),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(value: max == 0 ? 0 : Money.toCents('${m['expense']}') / max, minHeight: 8, color: LacoColors.verde, backgroundColor: LacoColors.areia),
              ),
            ]),
          ),
      ]),
    );
  }
}
