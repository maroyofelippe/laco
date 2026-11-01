import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../../core/data/models.dart';
import '../../core/notifications/notification_service.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../shared/widgets/brand.dart';
import '../../shared/widgets/common.dart';

final _notifGrantedProvider = FutureProvider.autoDispose<bool>((ref) => NotificationService.isGranted());

/// Aba "Mais": perfil, família ativa, atalhos, avisos e sair.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  Future<void> _switchFamily(BuildContext context, WidgetRef ref) async {
    final session = ref.read(sessionProvider).valueOrNull;
    if (session == null) return;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Trocar de família', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
          for (final f in session.families)
            ListTile(
              leading: Icon(f.id == session.familyId ? Icons.radio_button_checked : Icons.radio_button_off, color: LacoColors.verde),
              title: Text(f.name),
              subtitle: Text(roleLabels[f.role] ?? f.role),
              onTap: () => Navigator.pop(ctx, f.id),
            ),
          ListTile(
            leading: const Icon(Icons.add, color: LacoColors.verde),
            title: const Text('Entrar ou criar outra família'),
            onTap: () => Navigator.pop(ctx, '__new__'),
          ),
        ]),
      ),
    );
    if (chosen == null || !context.mounted) return;
    if (chosen == '__new__') {
      context.push('/familias');
      return;
    }
    if (chosen == session.familyId) return;
    await ref.read(sessionProvider.notifier).selectFamily(chosen);
    if (context.mounted) context.go('/inicio');
  }

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final status = ref.read(syncProvider);
    final unsent = status.pending + status.failed;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sair do Laço?'),
        content: Text(
          unsent > 0
              ? 'Há $unsent ${unsent == 1 ? 'alteração que ainda não foi enviada' : 'alterações que ainda não foram enviadas'}. '
                  'Se sair agora, elas serão perdidas. Conecte-se à internet e sincronize antes, se puder.'
              : 'Os dados guardados neste celular serão apagados. Eles continuam seguros na conta da família.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
            style: unsent > 0 ? FilledButton.styleFrom(backgroundColor: LacoColors.despesa) : null,
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(unsent > 0 ? 'Sair mesmo assim' : 'Sair'),
          ),
        ],
      ),
    );
    if (ok == true) await ref.read(sessionProvider.notifier).logout();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).valueOrNull;
    final fam = ref.watch(currentFamilyProvider);
    final user = session?.user;
    final sync = ref.watch(syncProvider);
    final notif = ref.watch(_notifGrantedProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Mais'), backgroundColor: LacoColors.fundo),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          LacoCard(
            child: Row(children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: LacoColors.verde,
                child: Text(_initials(user?.name ?? ''), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(user?.name ?? '', style: Theme.of(context).textTheme.titleMedium),
                  Text(user?.email ?? '', style: const TextStyle(color: LacoColors.apoio)),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 12),
          if (fam != null)
            LacoCard(
              onTap: () => _switchFamily(context, ref),
              child: Row(children: [
                const LacoSymbol(size: 36),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(fam.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    Text('Seu papel: ${roleLabels[fam.role] ?? fam.role}', style: const TextStyle(color: LacoColors.apoio)),
                  ]),
                ),
                const Text('Trocar', style: TextStyle(color: LacoColors.verde, fontWeight: FontWeight.w700)),
              ]),
            ),
          const SectionTitle('Organizar'),
          _Group(children: [
            _Item(icon: Icons.account_balance_wallet_outlined, title: 'Contas e cartões', onTap: () => context.push('/contas')),
            _Item(icon: Icons.pie_chart_outline, title: 'Orçamento do mês', onTap: () => context.push('/orcamento')),
            _Item(icon: Icons.speed_outlined, title: 'Limites combinados', onTap: () => context.push('/limites')),
            _Item(icon: Icons.notifications_none, title: 'Alertas', onTap: () => context.push('/alertas')),
          ]),
          const SectionTitle('Trazer lançamentos'),
          _Group(children: [
            if (fam?.canWrite ?? false) ...[
              _Item(icon: Icons.picture_as_pdf_outlined, title: 'Importar extrato ou fatura (PDF)', onTap: () => context.push('/importar')),
              _Item(icon: Icons.document_scanner_outlined, title: 'Ler nota fiscal', onTap: () => context.push('/nota-fiscal')),
            ] else
              const _Item(icon: Icons.visibility_outlined, title: 'Seu papel nesta família é só de leitura', subtitle: 'Peça a quem administra para mudar, se precisar lançar.'),
          ]),
          const SectionTitle('Este celular'),
          _Group(children: [
            _Item(
              icon: sync.failed > 0 ? Icons.sync_problem : Icons.sync,
              iconColor: sync.failed > 0 ? LacoColors.despesa : null,
              title: 'Sincronização',
              subtitle: sync.failed > 0
                  ? '${sync.failed} não ${sync.failed == 1 ? 'enviada' : 'enviadas'}'
                  : sync.pending > 0
                      ? '${sync.pending} aguardando envio'
                      : sync.offline
                          ? 'Sem conexão agora'
                          : 'Tudo em dia',
              onTap: () => context.push('/sincronizacao'),
            ),
            _Item(
              icon: Icons.notifications_active_outlined,
              title: 'Avisos de limites',
              subtitle: switch (notif) {
                AsyncData(value: true) => 'Ativados',
                AsyncData(value: false) => 'Desativados — toque para ativar',
                _ => '…',
              },
              onTap: () async {
                await NotificationService.requestWithRationale(context);
                ref.invalidate(_notifGrantedProvider);
              },
            ),
          ]),
          const SectionTitle('Sobre'),
          LacoCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const LacoLogo(size: 32),
              const SizedBox(height: 10),
              const Text(LacoBrand.tagline, style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              const Text(LacoBrand.promise, style: TextStyle(color: LacoColors.apoio)),
              const SizedBox(height: 10),
              Text('Versão 0.1.0 · servidor ${Uri.tryParse(AppConfig.apiUrl)?.host ?? ''}', style: const TextStyle(color: LacoColors.apoio, fontSize: 12)),
            ]),
          ),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            onPressed: () => _logout(context, ref),
            style: OutlinedButton.styleFrom(foregroundColor: LacoColors.despesa, side: const BorderSide(color: LacoColors.borda)),
            icon: const Icon(Icons.logout),
            label: const Text('Sair'),
          ),
        ],
      ),
    );
  }

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    final first = parts.first[0];
    final last = parts.length > 1 ? parts.last[0] : '';
    return (first + last).toUpperCase();
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LacoCard(
        padding: EdgeInsets.zero,
        child: Column(children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const Divider(height: 1, indent: 56, color: LacoColors.borda),
            children[i],
          ],
        ]),
      );
}

class _Item extends StatelessWidget {
  const _Item({required this.icon, required this.title, this.subtitle, this.onTap, this.iconColor});
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) => ListTile(
        leading: Icon(icon, color: iconColor ?? LacoColors.verde),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: subtitle == null ? null : Text(subtitle!, style: const TextStyle(color: LacoColors.apoio)),
        trailing: onTap == null ? null : const Icon(Icons.chevron_right, color: LacoColors.apoio),
        onTap: onTap,
      );
}
