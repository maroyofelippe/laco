import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/data/lookups_repository.dart';
import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/color.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../shared/widgets/common.dart';
import '../transactions/pickers.dart';

/// Item extraído do PDF + correções feitas na revisão (enviadas juntas na confirmação).
class _Item {
  _Item(Map<String, dynamic> j)
      : id = '${j['id']}',
        raw = '${j['rawText']}',
        description = '${j['description'] ?? ''}',
        amount = j['amount'] as String?,
        date = j['occurredOn'] as String?,
        type = (j['type'] as String?) ?? 'EXPENSE',
        categoryId = j['categoryId'] as String?,
        accept = j['decision'] != 'SKIP',
        confidence = (j['confidence'] as num?)?.toDouble() ?? 1,
        installment = j['installmentHint'] as String?,
        duplicate = j['duplicate'] is Map ? Map<String, dynamic>.from(j['duplicate'] as Map) : null,
        _orig = Map<String, dynamic>.from(j);

  final String id;
  final String raw;
  String description;
  String? amount;
  String? date;
  String type;
  String? categoryId;
  bool accept;
  final double confidence;
  final String? installment;
  final Map<String, dynamic>? duplicate;
  final Map<String, dynamic> _orig;

  bool get ready => !accept || (categoryId != null && amount != null && date != null && description.trim().isNotEmpty);

  /// Só o que mudou em relação ao que a API extraiu.
  Map<String, dynamic>? edits() {
    final e = <String, dynamic>{'itemId': id};
    if (accept != (_orig['decision'] != 'SKIP')) e['decision'] = accept ? 'ACCEPT' : 'SKIP';
    if (description != '${_orig['description'] ?? ''}') e['description'] = description;
    if (amount != _orig['amount']) e['amount'] = amount;
    if (date != _orig['occurredOn']) e['occurredOn'] = date;
    if (type != _orig['type']) e['type'] = type;
    if (categoryId != _orig['categoryId']) e['categoryId'] = categoryId;
    return e.length > 1 ? e : null;
  }
}

class ImportReviewScreen extends ConsumerStatefulWidget {
  const ImportReviewScreen({super.key, required this.batchId});
  final String batchId;

  @override
  ConsumerState<ImportReviewScreen> createState() => _ImportReviewScreenState();
}

class _ImportReviewScreenState extends ConsumerState<ImportReviewScreen> {
  Map<String, dynamic>? _batch;
  List<_Item> _items = [];
  Object? _error;
  bool _onlyMissing = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final fam = ref.read(currentFamilyProvider)!;
    try {
      final b = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/families/${fam.id}/imports/${widget.batchId}');
      setState(() {
        _batch = b;
        _items = asList(b['items']).map(_Item.new).toList();
        _error = null;
      });
    } catch (e) {
      setState(() => _error = e);
    }
  }

  Future<void> _confirm() async {
    final fam = ref.read(currentFamilyProvider)!;
    setState(() => _busy = true);
    try {
      final edits = _items.map((i) => i.edits()).whereType<Map<String, dynamic>>().toList();
      final r = await ref.read(apiClientProvider).post<Map<String, dynamic>>('/families/${fam.id}/imports/${widget.batchId}/confirm', body: {'items': edits});
      await ref.read(syncProvider.notifier).syncNow();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          icon: const Icon(Icons.check_circle_outline, color: LacoColors.receita, size: 40),
          title: Text('${r['created']} lançamento(s) importado(s)'),
          content: Text([
            if ((r['skipped'] as num? ?? 0) > 0) '${r['skipped']} item(ns) ficaram de fora.',
            if ((r['duplicatesSkipped'] as num? ?? 0) > 0) '${r['duplicatesSkipped']} já existiam e não foram repetidos.',
            'As categorias escolhidas serão sugeridas automaticamente nos próximos extratos.',
          ].join(' ')),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Ver lançamentos'))],
        ),
      );
      if (mounted) context.go('/lancamentos');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.userMessage, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final fam = ref.read(currentFamilyProvider)!;
    try {
      await ref.read(apiClientProvider).post<dynamic>('/families/${fam.id}/imports/${widget.batchId}/cancel');
      if (mounted) context.pop();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.userMessage, error: true);
    }
  }

  Future<void> _applyCategoryToSelected(Lookups lk) async {
    final c = await pickCategory(context, lk, 'EXPENSE');
    if (c == null) return;
    setState(() {
      for (final i in _items.where((i) => i.accept && i.type == c.kind)) {
        i.categoryId = c.id;
      }
    });
  }

  Future<void> _edit(_Item item, Lookups lk) async {
    final desc = TextEditingController(text: item.description);
    final amount = TextEditingController(text: Money.toInput(item.amount));
    var type = item.type;
    var date = item.date ?? Dates.today();
    var categoryId = item.categoryId;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: LacoColors.fundo,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Corrigir item', style: Theme.of(ctx).textTheme.titleLarge),
            Text('No PDF: ${item.raw}', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [ButtonSegment(value: 'EXPENSE', label: Text('Despesa')), ButtonSegment(value: 'INCOME', label: Text('Receita'))],
              selected: {type},
              onSelectionChanged: (s) => setSheet(() {
                type = s.first;
                if (lk.category(categoryId)?.kind != type) categoryId = null;
              }),
            ),
            const SizedBox(height: 12),
            TextField(controller: desc, decoration: AppTheme.input('Descrição')),
            const SizedBox(height: 12),
            TextField(controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: AppTheme.input('Valor')),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Data'),
              subtitle: Text(Dates.format(date)),
              trailing: const Icon(Icons.event_outlined),
              onTap: () async {
                final d = await showDatePicker(context: ctx, initialDate: Dates.parse(date), firstDate: DateTime(2000), lastDate: DateTime(DateTime.now().year + 2));
                if (d != null) setSheet(() => date = Dates.iso(d));
              },
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Categoria'),
              subtitle: Text(categoryId == null ? 'Escolher' : lk.categoryPath(categoryId!)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                final c = await pickCategory(ctx, lk, type);
                if (c != null) setSheet(() => categoryId = c.id);
              },
            ),
            const SizedBox(height: 8),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Salvar correção')),
          ]),
        ),
      ),
    );
    if (saved != true) return;
    final parsed = Money.parseInput(amount.text);
    setState(() {
      item.description = desc.text.trim();
      if (parsed != null) item.amount = parsed;
      item.type = type;
      item.date = date;
      item.categoryId = categoryId;
      item.accept = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final lk = ref.watch(lookupsProvider).valueOrNull ?? const Lookups();
    final b = _batch;
    if (_error != null) return Scaffold(appBar: AppBar(), body: ErrorState(error: _error!, onRetry: _load));
    if (b == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final inReview = b['status'] == 'REVIEW';
    final accepted = _items.where((i) => i.accept).toList();
    final missing = accepted.where((i) => !i.ready).length;
    final visible = _onlyMissing ? _items.where((i) => !i.ready).toList() : _items;
    final stats = asMap(b['stats']);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Revisar importação'),
        backgroundColor: LacoColors.fundo,
        actions: [if (inReview) TextButton(onPressed: _cancel, child: const Text('Cancelar'))],
      ),
      bottomNavigationBar: inReview
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  if (missing > 0) Padding(padding: const EdgeInsets.only(bottom: 6), child: Text('$missing item(ns) marcado(s) sem categoria', style: const TextStyle(color: LacoColors.douradoTexto, fontWeight: FontWeight.w700))),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _busy || missing > 0 ? null : _confirm,
                      child: Text(_busy ? 'Importando...' : 'Confirmar ${accepted.length} lançamento(s)'),
                    ),
                  ),
                ]),
              ),
            )
          : null,
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: [
        Text('${b['fileName']}', style: Theme.of(context).textTheme.titleMedium),
        if (stats['alreadyImportedAt'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: LacoCard(color: LacoColors.douradoClaro, borderColor: LacoColors.dourado, child: Text('Este arquivo já foi importado em ${Dates.dateTime('${stats['alreadyImportedAt']}')}. Itens repetidos vêm desmarcados.')),
          ),
        if (!inReview)
          Padding(padding: const EdgeInsets.only(top: 8), child: StatusPill(b['status'] == 'CONFIRMED' ? 'Importação confirmada' : b['status'] == 'FAILED' ? '${b['failureReason']}' : 'Importação cancelada', tone: b['status'] == 'CONFIRMED' ? PillTone.good : PillTone.neutral)),
        const SizedBox(height: 8),
        Text('${_items.length} item(ns) encontrados · ${stats['probableDuplicates'] ?? 0} possível(is) duplicata(s)', style: const TextStyle(color: LacoColors.apoio)),
        if (inReview)
          Wrap(spacing: 6, children: [
            ActionChip(label: const Text('Marcar todos'), onPressed: () => setState(() { for (final i in _items) { i.accept = true; } })),
            ActionChip(label: const Text('Desmarcar todos'), onPressed: () => setState(() { for (final i in _items) { i.accept = false; } })),
            FilterChip(label: const Text('Só sem categoria'), selected: _onlyMissing, onSelected: (v) => setState(() => _onlyMissing = v), selectedColor: LacoColors.verdeClaro),
            ActionChip(avatar: const Icon(Icons.sell_outlined, size: 16), label: const Text('Categoria p/ marcados'), onPressed: () => _applyCategoryToSelected(lk)),
          ]),
        const SizedBox(height: 8),
        for (final i in visible) _ItemTile(item: i, lk: lk, enabled: inReview, onToggle: (v) => setState(() => i.accept = v), onEdit: () => _edit(i, lk)),
      ]),
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item, required this.lk, required this.enabled, required this.onToggle, required this.onEdit});
  final _Item item;
  final Lookups lk;
  final bool enabled;
  final ValueChanged<bool> onToggle;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final dup = item.duplicate;
    final cat = lk.category(item.categoryId);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: LacoCard(
        onTap: enabled ? onEdit : null,
        padding: const EdgeInsets.fromLTRB(4, 8, 12, 8),
        borderColor: item.accept && !item.ready ? LacoColors.dourado : null,
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Checkbox(value: item.accept, onChanged: enabled ? (v) => onToggle(v ?? false) : null),
          Expanded(
            child: Opacity(
              opacity: item.accept ? 1 : 0.55,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(item.description.isEmpty ? '(sem descrição)' : item.description, style: const TextStyle(fontWeight: FontWeight.w700))),
                  if (item.amount != null) AmountText(item.amount!, outflow: item.type == 'EXPENSE', signed: true),
                ]),
                const SizedBox(height: 2),
                Text('${Dates.format(item.date)}${item.installment != null ? ' · parcela ${item.installment}' : ''}', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
                const SizedBox(height: 6),
                Wrap(spacing: 6, runSpacing: 4, children: [
                  cat == null
                      ? const StatusPill('Escolher categoria', tone: PillTone.warn)
                      : Chip(
                          visualDensity: VisualDensity.compact,
                          avatar: CircleAvatar(backgroundColor: hexColor(cat.color ?? lk.category(cat.parentId)?.color), radius: 5),
                          label: Text(lk.categoryPath(cat.id), style: const TextStyle(fontSize: 12)),
                          backgroundColor: LacoColors.areia,
                          side: BorderSide.none,
                        ),
                  if (dup != null) StatusPill(dup['level'] == 'PROBABLE' ? 'Possível duplicata' : 'Confira se já existe', tone: dup['level'] == 'PROBABLE' ? PillTone.bad : PillTone.warn),
                  if (item.confidence < 0.8) const StatusPill('Confira os dados', tone: PillTone.warn),
                ]),
                if (dup != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text('Parece com "${dup['description']}" em ${Dates.format('${dup['occurredOn']}')} (${Money.format('${dup['amount']}')})', style: const TextStyle(fontSize: 12, color: LacoColors.apoio)),
                  ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
