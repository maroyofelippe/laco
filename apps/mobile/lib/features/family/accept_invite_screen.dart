import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/laco_tokens.dart';
import '../../shared/widgets/brand.dart';

class AcceptInviteScreen extends ConsumerStatefulWidget {
  const AcceptInviteScreen({super.key, required this.token});
  final String token;

  @override
  ConsumerState<AcceptInviteScreen> createState() => _AcceptInviteScreenState();
}

class _AcceptInviteScreenState extends ConsumerState<AcceptInviteScreen> {
  String? _error;
  String? _familyName;

  @override
  void initState() {
    super.initState();
    _accept();
  }

  Future<void> _accept() async {
    setState(() => _error = null);
    try {
      final fam = await ref.read(sessionProvider.notifier).acceptInvite(widget.token);
      setState(() => _familyName = fam.name);
    } on ApiException catch (e) {
      setState(() => _error = e.userMessage);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Center(child: LacoSymbol(size: 64)),
              const SizedBox(height: 24),
              if (_familyName == null && _error == null) ...[
                const Center(child: CircularProgressIndicator()),
                const SizedBox(height: 16),
                const Text('Aceitando o convite...', textAlign: TextAlign.center),
              ],
              if (_familyName != null) ...[
                Text('Bem-vindo(a) à $_familyName!', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                const Text('Agora vocês organizam o dinheiro da família juntos.', textAlign: TextAlign.center, style: TextStyle(color: LacoColors.apoio)),
                const SizedBox(height: 24),
                FilledButton(onPressed: () => context.go('/inicio'), child: const Text('Ver o mês da família')),
              ],
              if (_error != null) ...[
                Text('Não foi possível aceitar o convite', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: LacoColors.apoio)),
                const SizedBox(height: 24),
                FilledButton(onPressed: _accept, child: const Text('Tentar de novo')),
                TextButton(onPressed: () => context.go('/familias'), child: const Text('Voltar')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
