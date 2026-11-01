import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/data/models.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/laco_tokens.dart';
import '../../shared/widgets/brand.dart';
import '../../shared/widgets/common.dart';

/// Escolher a família, aceitar um convite ou criar uma família nova.
class FamilySelectScreen extends ConsumerStatefulWidget {
  const FamilySelectScreen({super.key});

  @override
  ConsumerState<FamilySelectScreen> createState() => _FamilySelectScreenState();
}

class _FamilySelectScreenState extends ConsumerState<FamilySelectScreen> {
  final _invite = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _invite.dispose();
    super.dispose();
  }

  /// Aceita "inv_..." ou o link completo "laco://convite/inv_...".
  String _token(String raw) {
    final t = raw.trim();
    final i = t.lastIndexOf('/');
    return i >= 0 ? t.substring(i + 1) : t;
  }

  Future<void> _accept() async {
    final t = _token(_invite.text);
    if (t.length < 20) {
      showSnack(context, 'Cole o código ou o link do convite.', error: true);
      return;
    }
    context.go('/convite/$t');
  }

  Future<void> _create() async {
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = TextEditingController();
        return AlertDialog(
          title: const Text('Criar família'),
          content: TextField(controller: c, autofocus: true, textCapitalization: TextCapitalization.words, decoration: AppTheme.input('Nome', hint: 'Ex.: Família Silva')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, c.text), child: const Text('Criar')),
          ],
        );
      },
    );
    if (name == null || name.trim().length < 2) return;
    setState(() => _busy = true);
    try {
      await ref.read(sessionProvider.notifier).createFamily(name);
      if (mounted) context.go('/inicio');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.userMessage, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).valueOrNull;
    final families = session?.families ?? const <FamilyRef>[];
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => ref.read(sessionProvider.notifier).refreshFamilies(),
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const Align(alignment: Alignment.centerLeft, child: LacoLogo(size: 30)),
              const SizedBox(height: 24),
              Text('Olá, ${session?.user?.name ?? ''}', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text(families.isEmpty ? 'Você ainda não faz parte de uma família por aqui.' : 'Qual família você quer acompanhar?', style: const TextStyle(color: LacoColors.apoio)),
              const SizedBox(height: 20),
              for (final f in families)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: LacoCard(
                    onTap: () async {
                      await ref.read(sessionProvider.notifier).selectFamily(f.id);
                      if (context.mounted) context.go('/inicio');
                    },
                    child: Row(children: [
                      const CircleAvatar(backgroundColor: LacoColors.verdeClaro, child: Icon(Icons.house_outlined, color: LacoColors.verde)),
                      const SizedBox(width: 12),
                      Expanded(child: Text(f.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
                      StatusPill(roleLabels[f.role] ?? f.role, tone: PillTone.info),
                    ]),
                  ),
                ),
              const SectionTitle('Recebeu um convite?'),
              TextField(controller: _invite, decoration: AppTheme.input('Código ou link do convite', prefix: const Icon(Icons.mail_outline))),
              const SizedBox(height: 10),
              OutlinedButton(onPressed: _accept, child: const Text('Aceitar convite')),
              const SectionTitle('Ou comece uma família'),
              FilledButton.icon(onPressed: _busy ? null : _create, icon: const Icon(Icons.add), label: const Text('Criar família')),
              const SizedBox(height: 24),
              TextButton(onPressed: () => ref.read(sessionProvider.notifier).logout(), child: const Text('Sair da conta')),
            ],
          ),
        ),
      ),
    );
  }
}
