import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/config.dart';
import '../../core/data/models.dart';
import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/color.dart';
import '../../core/util/dates.dart';
import '../../shared/widgets/common.dart';
import 'transactions_providers.dart';

/// Fotos de nota anexadas (só online; a imagem é baixada pela API com autorização).
final _attachmentsProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, txId) async {
  final fam = ref.watch(currentFamilyProvider);
  if (fam == null) return const [];
  try {
    return asList(await ref.read(apiClientProvider).get<dynamic>('/families/${fam.id}/transactions/$txId/attachments'));
  } on ApiException {
    return const [];
  }
});

class TransactionDetailScreen extends ConsumerWidget {
  const TransactionDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fam = ref.watch(currentFamilyProvider);
    final txn = ref.watch(transactionProvider(id));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lançamento'),
        backgroundColor: LacoColors.fundo,
        actions: [
          if ((fam?.canWrite ?? false) && txn.valueOrNull != null) ...[
            IconButton(tooltip: 'Editar', onPressed: () => context.push('/lancamento/$id/editar'), icon: const Icon(Icons.edit_outlined)),
            IconButton(tooltip: 'Excluir', onPressed: () => _delete(context, ref, txn.value!), icon: const Icon(Icons.delete_outline)),
          ],
        ],
      ),
      body: AsyncBody<Txn?>(
        value: txn,
        builder: (t) {
          if (t == null) return const EmptyState(icon: Icons.search_off, title: 'Lançamento não encontrado', message: 'Ele pode ter sido excluído por outra pessoa da família.');
          Widget row(String label, String value) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(width: 120, child: Text(label, style: const TextStyle(color: LacoColors.apoio))),
                  Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600))),
                ]),
              );
          return ListView(padding: const EdgeInsets.all(16), children: [
            if (t.syncError != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: LacoCard(color: LacoColors.despesaClaro, borderColor: LacoColors.despesa, child: Text('Não foi enviado: ${t.syncError}', style: const TextStyle(color: LacoColors.despesa))),
              )
            else if (t.pending)
              const Padding(padding: EdgeInsets.only(bottom: 12), child: StatusPill('Aguardando envio', tone: PillTone.warn)),
            LacoCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  CircleAvatar(backgroundColor: hexColor(t.categoryColor).withValues(alpha: 0.15), child: Icon(Icons.sell_outlined, color: hexColor(t.categoryColor))),
                  const SizedBox(width: 12),
                  Expanded(child: Text(t.description, style: Theme.of(context).textTheme.titleMedium)),
                ]),
                const SizedBox(height: 12),
                AmountText(t.amount, outflow: t.isOutflow, signed: true, style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
                const Divider(height: 28),
                row('Tipo', const {'INCOME': 'Receita', 'EXPENSE': 'Despesa', 'TRANSFER_IN': 'Transferência (entrada)', 'TRANSFER_OUT': 'Transferência (saída)', 'CARD_PAYMENT': 'Pagamento de fatura'}[t.type] ?? t.type),
                row('Data', Dates.format(t.occurredOn)),
                row('Categoria', t.categoryName),
                row(t.cardId != null ? 'Cartão' : 'Conta', t.meansName),
                if (t.statementMonth != null) row('Fatura', Dates.monthShort(t.statementMonth!)),
                if (t.memberName != null) row('Quem', t.memberName!),
                if (t.installmentNumber != null) row('Parcela', '${t.installmentNumber}'),
                row('Origem', const {'MANUAL': 'Lançado à mão', 'PDF_IMPORT': 'Importado de extrato', 'RECEIPT_OCR': 'Nota fiscal', 'RECURRENCE': 'Recorrente'}[t.source] ?? t.source),
                if (t.notes != null && t.notes!.isNotEmpty) row('Observações', t.notes!),
              ]),
            ),
            _Attachments(txId: t.id),
          ]);
        },
      ),
    );
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, Txn t) async {
    String? scope = 'this';
    if (t.installmentPlanId != null && !t.pending) {
      scope = await showDialog<String>(
        context: context,
        builder: (ctx) => SimpleDialog(title: const Text('Excluir quais parcelas?'), children: [
          SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'this'), child: const Text('Só esta parcela')),
          SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'future'), child: const Text('Esta e as próximas')),
          SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'all'), child: const Text('Todas as parcelas')),
        ]),
      );
    } else {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Excluir lançamento?'),
          content: Text(t.isTransfer ? 'As duas pontas da transferência serão excluídas.' : '"${t.description}" sai dos relatórios da família.'),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Excluir'))],
        ),
      );
      if (ok != true) scope = null;
    }
    if (scope == null) return;
    final fam = ref.read(currentFamilyProvider)!;
    await ref.read(transactionsRepositoryProvider).delete(fam.id, t, scope: scope);
    ref.read(syncProvider.notifier).syncSoon();
    if (context.mounted) {
      showSnack(context, 'Lançamento excluído');
      context.pop();
    }
  }
}

class _Attachments extends ConsumerWidget {
  const _Attachments({required this.txId});
  final String txId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final files = ref.watch(_attachmentsProvider(txId)).valueOrNull ?? const [];
    if (files.isEmpty) return const SizedBox.shrink();
    return FutureBuilder<String?>(
      future: ref.read(tokenStoreProvider).accessToken(),
      builder: (context, snap) {
        if (!snap.hasData) return const SizedBox.shrink();
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SectionTitle('Foto da nota'),
          for (final f in files)
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.network('${AppConfig.apiUrl}${f['url']}', headers: {'Authorization': 'Bearer ${snap.data}'}, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Text('Não foi possível carregar a foto agora.')),
            ),
        ]);
      },
    );
  }
}

