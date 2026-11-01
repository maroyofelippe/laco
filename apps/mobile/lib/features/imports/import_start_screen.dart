import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/data/lookups_repository.dart';
import '../../core/data/remote_cache.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../shared/widgets/common.dart';
import '../transactions/transaction_form_screen.dart';

final _recentImportsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final fam = ref.watch(currentFamilyProvider)!;
  try {
    return asList(await ref.read(apiClientProvider).get<dynamic>('/families/${fam.id}/imports', query: {'limit': 10}));
  } on ApiException {
    return const [];
  }
});

const _importStatus = {'REVIEW': 'Para revisar', 'CONFIRMED': 'Confirmada', 'FAILED': 'Não lida', 'CANCELLED': 'Cancelada', 'PROCESSING': 'Lendo...', 'QUEUED': 'Na fila'};

/// Importar extrato em PDF: escolher o tipo e o destino, enviar e revisar.
/// O arquivo é escolhido pelo seletor de documentos do Android (sem permissão de armazenamento).
class ImportStartScreen extends ConsumerStatefulWidget {
  const ImportStartScreen({super.key});

  @override
  ConsumerState<ImportStartScreen> createState() => _ImportStartScreenState();
}

class _ImportStartScreenState extends ConsumerState<ImportStartScreen> {
  String _type = 'CARD_STATEMENT';
  String? _targetId;
  double? _progress;
  Map<String, dynamic>? _failed;

  Future<void> _pickAndSend(Lookups lk) async {
    if (_targetId == null) {
      showSnack(context, _type == 'CARD_STATEMENT' ? 'Escolha o cartão da fatura.' : 'Escolha a conta do extrato.', error: true);
      return;
    }
    final picked = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: const ['pdf']);
    final file = picked?.files.single;
    if (file?.path == null) return;
    if ((file!.size) > 20 * 1024 * 1024) {
      if (mounted) showSnack(context, 'O PDF passa de 20 MB. Envie um arquivo menor.', error: true);
      return;
    }
    await _upload(file.path!, file.name, null);
  }

  Future<void> _upload(String path, String name, String? password) async {
    final fam = ref.read(currentFamilyProvider)!;
    setState(() {
      _progress = 0;
      _failed = null;
    });
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(path, filename: name),
        'sourceType': _type,
        if (_type == 'CARD_STATEMENT') 'targetCardId': _targetId else 'targetAccountId': _targetId,
        if (password != null) 'password': password,
      });
      final res = await ref.read(apiClientProvider).upload<Map<String, dynamic>>('/families/${fam.id}/imports', form, onSendProgress: (s, t) {
        if (t > 0 && mounted) setState(() => _progress = s / t);
      });
      if (!mounted) return;
      if (res['status'] == 'REVIEW') {
        context.pushReplacement('/importar/${res['id']}');
      } else {
        setState(() => _failed = res);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'PDF_PASSWORD_REQUIRED' || e.code == 'PDF_PASSWORD_INVALID') {
        final pw = await _askPassword(invalid: e.code == 'PDF_PASSWORD_INVALID');
        if (pw != null && pw.isNotEmpty) return _upload(path, name, pw);
      } else {
        showSnack(context, e.userMessage, error: true);
      }
    } finally {
      if (mounted) setState(() => _progress = null);
    }
  }

  Future<String?> _askPassword({required bool invalid}) {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('PDF protegido por senha'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(invalid ? 'A senha não conferiu. Tente de novo.' : 'Muitos bancos protegem o extrato com senha (ex.: parte do CPF). Ela é usada só para abrir o arquivo e não fica guardada.'),
          const SizedBox(height: 12),
          TextField(controller: c, obscureText: true, autofocus: true, decoration: AppTheme.input('Senha do arquivo')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')), FilledButton(onPressed: () => Navigator.pop(ctx, c.text), child: const Text('Abrir'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lk = ref.watch(lookupsProvider).valueOrNull ?? const Lookups();
    final recent = ref.watch(_recentImportsProvider).valueOrNull ?? const [];
    final targets = _type == 'CARD_STATEMENT'
        ? [for (final c in lk.activeCards) (c.id, c.name)]
        : [for (final a in lk.activeAccounts.where((a) => _type == 'SAVINGS' ? a.type == 'SAVINGS' : a.type != 'SAVINGS')) (a.id, a.name)];

    return Scaffold(
      appBar: AppBar(title: const Text('Importar extrato'), backgroundColor: LacoColors.fundo),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const Text('Envie o PDF do banco. Mostramos os lançamentos para você revisar: nada entra na conta da família sem a sua confirmação.', style: TextStyle(color: LacoColors.apoio)),
        const SectionTitle('Que extrato é este?'),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'CARD_STATEMENT', label: Text('Fatura'), icon: Icon(Icons.credit_card)),
            ButtonSegment(value: 'CHECKING', label: Text('Conta'), icon: Icon(Icons.account_balance_outlined)),
            ButtonSegment(value: 'SAVINGS', label: Text('Poupança'), icon: Icon(Icons.savings_outlined)),
          ],
          selected: {_type},
          onSelectionChanged: (s) => setState(() {
            _type = s.first;
            _targetId = null;
          }),
        ),
        SectionTitle(_type == 'CARD_STATEMENT' ? 'De qual cartão?' : 'De qual conta?'),
        if (targets.isEmpty) const Text('Nenhum destino disponível para você.', style: TextStyle(color: LacoColors.apoio)),
        RadioGroup<String>(
          groupValue: _targetId,
          onChanged: (v) => setState(() => _targetId = v),
          child: Column(children: [
            for (final t in targets) RadioListTile<String>(value: t.$1, title: Text(t.$2), contentPadding: EdgeInsets.zero),
          ]),
        ),
        const SizedBox(height: 16),
        if (_progress != null) ...[
          LinearProgressIndicator(value: _progress == 0 ? null : _progress, color: LacoColors.verde, backgroundColor: LacoColors.areia),
          const SizedBox(height: 8),
          Text((_progress ?? 0) >= 1 ? 'Lendo os lançamentos do PDF...' : 'Enviando o arquivo...', textAlign: TextAlign.center),
        ] else
          FilledButton.icon(onPressed: () => _pickAndSend(lk), icon: const Icon(Icons.upload_file), label: const Text('Escolher PDF')),
        if (_failed != null) ...[
          const SizedBox(height: 16),
          LacoCard(
            color: LacoColors.douradoClaro,
            borderColor: LacoColors.dourado,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Não conseguimos ler este arquivo', style: TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text('${_failed!['failureReason'] ?? 'Formato não reconhecido.'}'),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => context.push('/lancamento/novo', extra: TxnFormArgs(cardId: _type == 'CARD_STATEMENT' ? _targetId : null, accountId: _type == 'CARD_STATEMENT' ? null : _targetId)),
                child: const Text('Cadastrar manualmente'),
              ),
            ]),
          ),
        ],
        if (recent.isNotEmpty) ...[
          const SectionTitle('Importações recentes'),
          LacoCard(
            padding: EdgeInsets.zero,
            child: Column(children: [
              for (final r in recent)
                ListTile(
                  onTap: () => context.push('/importar/${r['id']}'),
                  title: Text('${r['fileName']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(Dates.dateTime('${r['createdAt']}')),
                  trailing: StatusPill(_importStatus['${r['status']}'] ?? '${r['status']}', tone: r['status'] == 'REVIEW' ? PillTone.warn : r['status'] == 'CONFIRMED' ? PillTone.good : PillTone.neutral),
                ),
            ]),
          ),
        ],
      ]),
    );
  }
}
