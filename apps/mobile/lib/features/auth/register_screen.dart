import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/laco_tokens.dart';
import '../../shared/widgets/brand.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).register(_name.text, _email.text, _password.text);
    } on ApiException catch (e) {
      setState(() => _error = e.userMessage);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: () => context.go('/entrar')), backgroundColor: Colors.transparent),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Align(alignment: Alignment.centerLeft, child: LacoLogo(size: 32)),
                const SizedBox(height: 20),
                Text('Vamos organizar juntos?', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 6),
                const Text('Crie sua conta. Depois você cria uma família ou aceita um convite.', style: TextStyle(color: LacoColors.apoio)),
                const SizedBox(height: 24),
                if (_error != null)
                  Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: const TextStyle(color: LacoColors.despesa))),
                TextFormField(controller: _name, textCapitalization: TextCapitalization.words, decoration: AppTheme.input('Como você quer ser chamado(a)'), validator: (v) => (v ?? '').trim().length < 2 ? 'Informe seu nome' : null),
                const SizedBox(height: 12),
                TextFormField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: AppTheme.input('E-mail'), validator: (v) => v == null || !v.contains('@') ? 'Informe um e-mail válido' : null),
                const SizedBox(height: 12),
                TextFormField(controller: _password, obscureText: true, decoration: AppTheme.input('Senha', helper: 'Pelo menos 8 caracteres'), validator: (v) => (v ?? '').length < 8 ? 'Use pelo menos 8 caracteres' : null),
                const SizedBox(height: 12),
                TextFormField(obscureText: true, decoration: AppTheme.input('Confirme a senha'), validator: (v) => v != _password.text ? 'As senhas não conferem' : null),
                const SizedBox(height: 20),
                FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Criando...' : 'Criar conta')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
