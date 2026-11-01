import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';

/// Cartão no padrão da marca: superfície branca, borda areia, cantos de 14.
class LacoCard extends StatelessWidget {
  const LacoCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap, this.color, this.borderColor});
  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? color;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color ?? LacoColors.superficie,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: borderColor ?? LacoColors.borda)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.action, this.onAction});
  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
        child: Row(
          children: [
            Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium)),
            if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
          ],
        ),
      );
}

/// Valor em reais com cor semântica: entradas em verde, saídas em terracota.
class AmountText extends StatelessWidget {
  const AmountText(this.amount, {super.key, this.outflow = false, this.signed = false, this.style});
  final String amount;
  final bool outflow;
  final bool signed;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final color = outflow ? LacoColors.despesa : LacoColors.receita;
    final text = '${signed ? (outflow ? '− ' : '+ ') : ''}${Money.format(amount)}';
    return Text(text, style: (style ?? const TextStyle(fontWeight: FontWeight.w700)).copyWith(color: color, fontFeatures: const [FontFeature.tabularFigures()]));
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action, this.onAction});
  final IconData icon;
  final String title;
  final String? message;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(radius: 32, backgroundColor: LacoColors.verdeClaro, child: Icon(icon, color: LacoColors.verde, size: 30)),
              const SizedBox(height: 16),
              Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
              if (message != null) ...[
                const SizedBox(height: 6),
                Text(message!, textAlign: TextAlign.center, style: const TextStyle(color: LacoColors.apoio)),
              ],
              if (action != null) ...[const SizedBox(height: 16), FilledButton(onPressed: onAction, child: Text(action!))],
            ],
          ),
        ),
      );
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final e = error;
    final offline = e is ApiException && e.isNetwork;
    return EmptyState(
      icon: offline ? Icons.cloud_off_outlined : Icons.sentiment_neutral_outlined,
      title: offline ? 'Sem conexão agora' : 'Não deu certo',
      message: e is ApiException ? e.userMessage : 'Tente novamente em instantes.',
      action: onRetry == null ? null : 'Tentar de novo',
      onAction: onRetry,
    );
  }
}

/// Mostra carregando / erro / conteúdo de um AsyncValue.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.builder, this.onRetry});
  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => value.when(
        data: builder,
        loading: () => const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),
        error: (e, _) => ErrorState(error: e, onRetry: onRetry),
      );
}

/// Barra de limite: verde (tranquilo) → dourado (perto do combinado) → terracota (acima).
class LimitBar extends StatelessWidget {
  const LimitBar({super.key, required this.pct, this.warnAt = 80});
  final num pct;
  final num warnAt;

  @override
  Widget build(BuildContext context) {
    final color = pct >= 100 ? LacoColors.despesa : pct >= warnAt ? LacoColors.dourado : LacoColors.receita;
    return Semantics(
      label: '${pct.round()}% do combinado',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(99),
        child: LinearProgressIndicator(value: (pct / 100).clamp(0, 1).toDouble(), minHeight: 8, color: color, backgroundColor: LacoColors.areia),
      ),
    );
  }
}

const limitStatusLabels = {'OK': 'Tranquilo', 'WARNING': 'Perto do combinado', 'EXCEEDED': 'Acima do combinado', 'INACTIVE': 'Pausado', 'INACTIVE_PERIOD': 'Fora do período'};

class StatusPill extends StatelessWidget {
  const StatusPill(this.label, {super.key, this.tone = PillTone.neutral});
  final String label;
  final PillTone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      PillTone.good => (LacoColors.verdeClaro, LacoColors.receita),
      PillTone.warn => (LacoColors.douradoClaro, LacoColors.douradoTexto),
      PillTone.bad => (LacoColors.despesaClaro, LacoColors.despesa),
      PillTone.info => (LacoColors.verdeClaro, LacoColors.verde),
      PillTone.neutral => (LacoColors.areia, LacoColors.apoio),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Text(label, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}

enum PillTone { good, warn, bad, info, neutral }

PillTone toneForLimit(String status) => switch (status) {
      'EXCEEDED' => PillTone.bad,
      'WARNING' => PillTone.warn,
      'OK' => PillTone.good,
      _ => PillTone.neutral,
    };

/// ‹ Outubro 2026 ›
class MonthSelector extends StatelessWidget {
  const MonthSelector({super.key, required this.month, required this.onChanged});
  final DateTime month;
  final ValueChanged<DateTime> onChanged;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(tooltip: 'Mês anterior', onPressed: () => onChanged(Dates.addMonths(month, -1)), icon: const Icon(Icons.chevron_left)),
          SizedBox(width: 160, child: Text(Dates.month(month), textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
          IconButton(tooltip: 'Próximo mês', onPressed: () => onChanged(Dates.addMonths(month, 1)), icon: const Icon(Icons.chevron_right)),
        ],
      );
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), backgroundColor: error ? LacoColors.despesa : LacoColors.tinta));
}

/// Lista para escolher um item numa folha inferior, com busca opcional.
Future<T?> showPickerSheet<T>(
  BuildContext context, {
  required String title,
  required List<T> items,
  required String Function(T) label,
  String Function(T)? subtitle,
  Widget Function(T)? leading,
  bool Function(T)? indented,
  bool searchable = false,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: LacoColors.fundo,
    builder: (ctx) => _PickerSheet<T>(title: title, items: items, label: label, subtitle: subtitle, leading: leading, indented: indented, searchable: searchable),
  );
}

class _PickerSheet<T> extends StatefulWidget {
  const _PickerSheet({required this.title, required this.items, required this.label, this.subtitle, this.leading, this.indented, required this.searchable});
  final String title;
  final List<T> items;
  final String Function(T) label;
  final String Function(T)? subtitle;
  final Widget Function(T)? leading;
  final bool Function(T)? indented;
  final bool searchable;

  @override
  State<_PickerSheet<T>> createState() => _PickerSheetState<T>();
}

class _PickerSheetState<T> extends State<_PickerSheet<T>> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final items = _q.isEmpty ? widget.items : widget.items.where((i) => widget.label(i).toLowerCase().contains(_q.toLowerCase())).toList();
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      builder: (ctx, scroll) => Column(
        children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: Align(alignment: Alignment.centerLeft, child: Text(widget.title, style: Theme.of(context).textTheme.titleLarge))),
          if (widget.searchable)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                autofocus: false,
                decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: 'Buscar', filled: true, fillColor: LacoColors.superficie, border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none)),
                onChanged: (v) => setState(() => _q = v),
              ),
            ),
          Expanded(
            child: ListView.builder(
              controller: scroll,
              itemCount: items.length,
              itemBuilder: (ctx, i) {
                final it = items[i];
                final indent = widget.indented?.call(it) ?? false;
                return ListTile(
                  contentPadding: EdgeInsets.only(left: indent ? 40 : 20, right: 20),
                  leading: widget.leading?.call(it),
                  title: Text(widget.label(it), style: TextStyle(fontWeight: indent ? FontWeight.w400 : FontWeight.w600)),
                  subtitle: widget.subtitle == null ? null : Text(widget.subtitle!(it)),
                  onTap: () => Navigator.pop(context, it),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
