import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/sync/outbox.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../shared/widgets/common.dart';

class _SyncInfo {
  const _SyncInfo(this.entries, this.lastSync);
  final List<OutboxEntry> entries;
  final String? lastSync;
}

final _syncInfoProvider = FutureProvider.autoDispose<_SyncInfo>((ref) async {
  ref.watch(dataVersionProvider);
  ref.watch(syncProvider.select((s) => (s.pending, s.failed, s.running)));
  final fam = ref.watch(currentFamilyProvider);
  if (fam == null) return const _SyncInfo([], null);
  final entries = await ref.watch(outboxProvider).list(familyId: fam.id);
  final last = await ref.watch(localDbProvider).getJson('lastSync:${fam.id}');
  return _SyncInfo(entries, last is String ? last : null);
});

/// O que está guardado só neste celular e o que já foi para a conta da família.
class SyncScreen extends ConsumerWidget {
  const SyncScreen({super.key});

  Future<void> _syncNow(BuildContext context, WidgetRef ref) async {
    final r = await ref.read(syncProvider.notifier).syncNow();
    if (!context.mounted || r == null) return;
    if (r.offline) {
      showSnack(context, 'Sem conexão. Tentaremos de novo quando a internet voltar.', error: true);
    } else if (r.error != null) {
      showSnack(context, r.error!, error: true);
    } else {
      showSnack(context, 'Tudo sincronizado.');
    }
  }

  Future<void> _retry(BuildContext context, WidgetRef ref, OutboxEntry e) async {
    await ref.read(outboxProvider).retry(e.id);
    await ref.read(syncProvider.notifier).refreshCounts();
    if (context.mounted) await _syncNow(context, ref);
  }

  Future<void> _discard(BuildContext context, WidgetRef ref, OutboxEntry e) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Descartar esta alteração?'),
        content: Text('${e.label} não será enviado para a família. Esta ação não pode ser desfeita.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Manter')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: LacoColors.despesa),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(outboxProvider).remove(e.id);
    final txns = ref.read(transactionsRepositoryProvider);
    switch (e.kind) {
      case 'TX_CREATE':
        // O lançamento só existia neste celular.
        if (e.localTxId != null) await txns.deleteLocal(e.localTxId!);
      case 'TX_INSTALLMENTS':
        if (e.localTxId != null) await txns.deletePendingPlaceholders(e.localTxId!);
      case 'ATTACHMENT':
        if (e.filePath != null) {
          try {
            await File(e.filePath!).delete();
          } catch (_) {}
        }
      default:
        // Edições/exclusões: na próxima sincronização o celular volta a mostrar o que está no servidor.
        break;
    }
    ref.read(syncProvider.notifier).syncSoon();
  }

  Future<void> _redownload(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Baixar tudo de novo?'),
        content: const Text(
          'Os lançamentos guardados neste celular serão recarregados da conta da família. '
          'Alterações que ainda não foram enviadas são mantidas.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Baixar')),
        ],
      ),
    );
    if (ok != true) return;
    final fam = ref.read(currentFamilyProvider);
    if (fam == null) return;
    await ref.read(syncEngineProvider).resetFamily(fam.id);
    if (context.mounted) await _syncNow(context, ref);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(syncProvider);
    final info = ref.watch(_syncInfoProvider);

    final (IconData icon, Color color, String title, String message) = status.running
        ? (Icons.sync, LacoColors.verde, 'Sincronizando…', 'Enviando e recebendo as novidades da família.')
        : status.failed > 0
            ? (Icons.sync_problem, LacoColors.despesa, 'Algumas alterações não foram aceitas', 'Veja abaixo o motivo de cada uma. Você pode tentar de novo ou descartar.')
            : status.offline
                ? (Icons.cloud_off_outlined, LacoColors.douradoTexto, 'Sem conexão agora', 'Pode continuar lançando: tudo fica guardado aqui e é enviado quando a internet voltar.')
                : status.pending > 0
                    ? (Icons.cloud_upload_outlined, LacoColors.douradoTexto, 'Aguardando envio', 'Há alterações guardadas neste celular que serão enviadas em instantes.')
                    : (Icons.cloud_done_outlined, LacoColors.receita, 'Tudo em dia', 'Este celular está com as mesmas informações da conta da família.');

    return Scaffold(
      appBar: AppBar(title: const Text('Sincronização'), backgroundColor: LacoColors.fundo),
      body: RefreshIndicator(
        onRefresh: () => _syncNow(context, ref),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            LacoCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  CircleAvatar(backgroundColor: color.withValues(alpha: 0.12), child: Icon(icon, color: color)),
                  const SizedBox(width: 12),
                  Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium)),
                ]),
                const SizedBox(height: 10),
                Text(message, style: const TextStyle(color: LacoColors.apoio)),
                const SizedBox(height: 10),
                Text(
                  'Última sincronização: ${info.valueOrNull?.lastSync == null ? 'ainda não houve' : Dates.dateTime(DateTime.parse(info.value!.lastSync!).toUtc().toIso8601String())}',
                  style: const TextStyle(color: LacoColors.apoio, fontSize: 13),
                ),
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: status.running ? null : () => _syncNow(context, ref),
                  icon: const Icon(Icons.sync),
                  label: const Text('Sincronizar agora'),
                ),
              ]),
            ),
            const SectionTitle('Fila deste celular'),
            AsyncBody<_SyncInfo>(
              value: info,
              onRetry: () => ref.invalidate(_syncInfoProvider),
              builder: (d) => d.entries.isEmpty
                  ? const LacoCard(
                      child: Row(children: [
                        Icon(Icons.check_circle_outline, color: LacoColors.receita),
                        SizedBox(width: 12),
                        Expanded(child: Text('Nada esperando envio.')),
                      ]),
                    )
                  : Column(children: [
                      for (final e in d.entries)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: _EntryCard(
                            entry: e,
                            onRetry: () => _retry(context, ref, e),
                            onDiscard: () => _discard(context, ref, e),
                          ),
                        ),
                    ]),
            ),
            const SectionTitle('Avançado'),
            LacoCard(
              onTap: status.running ? null : () => _redownload(context, ref),
              child: const Row(children: [
                Icon(Icons.cloud_download_outlined, color: LacoColors.verde),
                SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Baixar tudo de novo', style: TextStyle(fontWeight: FontWeight.w700)),
                    Text('Use se algo parecer diferente do que a família vê.', style: TextStyle(color: LacoColors.apoio)),
                  ]),
                ),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({required this.entry, required this.onRetry, required this.onDiscard});
  final OutboxEntry entry;
  final VoidCallback onRetry;
  final VoidCallback onDiscard;

  static const _kindLabels = {
    'TX_CREATE': 'Novo lançamento',
    'TX_INSTALLMENTS': 'Compra parcelada',
    'TX_UPDATE': 'Edição',
    'TX_DELETE': 'Exclusão',
    'RECURRENCE_CREATE': 'Lançamento recorrente',
    'ATTACHMENT': 'Foto anexada',
  };

  @override
  Widget build(BuildContext context) {
    final failed = entry.status == 'FAILED';
    return LacoCard(
      borderColor: failed ? LacoColors.despesa.withValues(alpha: 0.4) : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(entry.label, style: const TextStyle(fontWeight: FontWeight.w700))),
          StatusPill(failed ? 'Não enviado' : 'Aguardando', tone: failed ? PillTone.bad : PillTone.warn),
        ]),
        const SizedBox(height: 4),
        Text(
          '${_kindLabels[entry.kind] ?? entry.kind} · ${Dates.dateTime(entry.createdAt.toUtc().toIso8601String())}',
          style: const TextStyle(color: LacoColors.apoio, fontSize: 13),
        ),
        if (entry.lastError != null) ...[
          const SizedBox(height: 8),
          Text(entry.lastError!, style: TextStyle(color: failed ? LacoColors.despesa : LacoColors.apoio)),
        ],
        if (failed) ...[
          const SizedBox(height: 8),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            TextButton(onPressed: onDiscard, style: TextButton.styleFrom(foregroundColor: LacoColors.despesa), child: const Text('Descartar')),
            const SizedBox(width: 8),
            OutlinedButton(onPressed: onRetry, child: const Text('Tentar de novo')),
          ]),
        ],
      ]),
    );
  }
}
