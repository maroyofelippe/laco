import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_mlkit_barcode_scanning/google_mlkit_barcode_scanning.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../../core/data/lookups_repository.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/laco_tokens.dart';
import '../../core/util/dates.dart';
import '../../core/util/money.dart';
import '../../core/util/text.dart';
import '../../shared/widgets/common.dart';
import '../transactions/transaction_form_screen.dart';
import 'receipt_parser.dart';

/// Nota fiscal → lançamento.
///
/// Privacidade e permissões: a foto é tirada pelo app de câmera do próprio Android
/// (o Laço não pede a permissão CAMERA) ou escolhida no seletor de fotos do sistema
/// (sem acesso à galeria inteira). A leitura do texto e do QR Code acontece no aparelho
/// (ML Kit, sem enviar a imagem). Nada é salvo sem a pessoa conferir no formulário.
class ReceiptCaptureScreen extends ConsumerStatefulWidget {
  const ReceiptCaptureScreen({super.key});

  @override
  ConsumerState<ReceiptCaptureScreen> createState() => _ReceiptCaptureScreenState();
}

enum _Stage { intro, reading, review }

class _ReceiptCaptureScreenState extends ConsumerState<ReceiptCaptureScreen> {
  _Stage _stage = _Stage.intro;
  String? _imagePath;
  ReceiptData _data = const ReceiptData();
  String? _readError;

  final _amount = TextEditingController();
  final _merchant = TextEditingController();
  String _date = Dates.today();

  @override
  void initState() {
    super.initState();
    _cleanupOldPhotos();
  }

  /// Remove fotos antigas que não ficaram na fila de anexos (ex.: lançamento salvo sem a foto).
  Future<void> _cleanupOldPhotos() async {
    try {
      final dir = Directory(p.join((await getApplicationSupportDirectory()).path, 'receipts'));
      if (!await dir.exists()) return;
      final queued = (await ref.read(outboxProvider).list()).map((e) => e.filePath).whereType<String>().toSet();
      final cutoff = DateTime.now().subtract(const Duration(days: 2));
      await for (final f in dir.list()) {
        if (f is File && !queued.contains(f.path) && (await f.lastModified()).isBefore(cutoff)) await f.delete();
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _amount.dispose();
    _merchant.dispose();
    super.dispose();
  }

  Future<void> _pick(ImageSource source) async {
    final XFile? shot;
    try {
      shot = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 2200, requestFullMetadata: false);
    } catch (_) {
      if (mounted) showSnack(context, 'Não foi possível abrir a câmera ou as fotos.', error: true);
      return;
    }
    if (shot == null) return;
    setState(() {
      _stage = _Stage.reading;
      _readError = null;
    });

    // Cópia no armazenamento privado do app: o arquivo temporário da câmera pode sumir
    // antes de o anexo ser enviado (o envio pode esperar a conexão voltar).
    final dir = Directory(p.join((await getApplicationSupportDirectory()).path, 'receipts'));
    await dir.create(recursive: true);
    final ext = p.extension(shot.path).isEmpty ? '.jpg' : p.extension(shot.path);
    final dest = p.join(dir.path, '${const Uuid().v4()}$ext');
    await File(shot.path).copy(dest);

    ReceiptData data = const ReceiptData();
    final input = InputImage.fromFilePath(dest);
    final scanner = BarcodeScanner(formats: [BarcodeFormat.qrCode]);
    final recognizer = TextRecognizer(script: TextRecognitionScript.latin);
    try {
      final codes = await scanner.processImage(input);
      for (final c in codes) {
        final qr = c.rawValue == null ? null : parseNfceQr(c.rawValue!);
        if (qr != null) {
          data = qr;
          break;
        }
      }
      final text = await recognizer.processImage(input);
      data = data.merge(parseReceiptText(text.text));
    } catch (_) {
      _readError = 'Não conseguimos ler a nota. Você pode preencher os dados à mão.';
    } finally {
      await scanner.close();
      await recognizer.close();
    }

    if (!mounted) return;
    setState(() {
      _imagePath = dest;
      _data = data;
      _amount.text = Money.toInput(data.amount);
      _merchant.text = data.merchant ?? '';
      _date = data.date ?? Dates.today();
      if (data.isEmpty && _readError == null) {
        _readError = 'Não encontramos os dados nesta foto. Tente com mais luz e a nota esticada, ou preencha à mão.';
      }
      _stage = _Stage.review;
    });
  }

  Future<void> _discardPhoto() async {
    final path = _imagePath;
    if (path != null) {
      try {
        await File(path).delete();
      } catch (_) {}
    }
  }

  String? _suggestCategory(Lookups lk) {
    final options = lk.selectable('EXPENSE');
    for (final hint in categoryHintsFor(_merchant.text)) {
      final h = normalizeText(hint);
      final match = options.where((c) => normalizeText(c.name) == h).firstOrNull;
      if (match != null) return match.id;
    }
    return null;
  }

  Future<void> _continue() async {
    final amount = Money.parseInput(_amount.text);
    if (amount == null) {
      showSnack(context, 'Informe o valor total da nota.', error: true);
      return;
    }
    final lk = await ref.read(lookupsProvider.future);
    final notes = [
      if (_data.cnpj != null) 'CNPJ ${formatCnpj(_data.cnpj!)}',
      if (_data.accessKey != null) 'Chave ${_data.accessKey!.digits}',
    ].join(' · ');
    if (!mounted) return;
    context.pushReplacement(
      '/lancamento/novo',
      extra: TxnFormArgs(
        type: 'EXPENSE',
        amount: amount,
        description: _merchant.text.trim().isEmpty ? 'Compra' : _merchant.text.trim(),
        occurredOn: _date,
        categoryId: _suggestCategory(lk),
        source: 'RECEIPT_OCR',
        receiptImagePath: _imagePath,
        notes: notes.isEmpty ? null : notes,
      ),
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: Dates.parse(_date),
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (d != null) setState(() => _date = Dates.iso(d));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop && _stage == _Stage.review) _discardPhoto();
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Nota fiscal'), backgroundColor: LacoColors.fundo),
        body: switch (_stage) {
          _Stage.intro => _intro(),
          _Stage.reading => const Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                CircularProgressIndicator(),
                SizedBox(height: 16),
                Text('Lendo a nota…', style: TextStyle(color: LacoColors.apoio)),
              ]),
            ),
          _Stage.review => _review(),
        },
      ),
    );
  }

  Widget _intro() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          LacoCard(
            color: LacoColors.verdeClaro,
            borderColor: LacoColors.verdeBorda,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Icon(Icons.document_scanner_outlined, color: LacoColors.verde),
                const SizedBox(width: 10),
                Expanded(child: Text('Registrar a partir da nota', style: Theme.of(context).textTheme.titleMedium)),
              ]),
              const SizedBox(height: 10),
              const Text(
                'Tire uma foto do cupom ou da NFC-e. O Laço lê o valor, a data e o estabelecimento '
                'aqui mesmo no celular e você confere tudo antes de salvar.',
              ),
            ]),
          ),
          const SizedBox(height: 16),
          const _Tip(icon: Icons.lock_outline, text: 'A foto não sai do aparelho para ser lida. Ela só é enviada se você escolher anexá-la ao lançamento.'),
          const _Tip(icon: Icons.photo_camera_outlined, text: 'Usamos o app de câmera do Android: o Laço não pede acesso permanente à câmera.'),
          const _Tip(icon: Icons.qr_code_2, text: 'Deixe o QR Code da nota visível: ele traz os dados mais confiáveis.'),
          const _Tip(icon: Icons.wb_sunny_outlined, text: 'Boa luz e nota esticada ajudam na leitura.'),
          const SizedBox(height: 24),
          FilledButton.icon(onPressed: () => _pick(ImageSource.camera), icon: const Icon(Icons.photo_camera_outlined), label: const Text('Tirar foto')),
          const SizedBox(height: 10),
          OutlinedButton.icon(onPressed: () => _pick(ImageSource.gallery), icon: const Icon(Icons.photo_library_outlined), label: const Text('Escolher uma foto')),
          const SizedBox(height: 10),
          TextButton(onPressed: () => context.pushReplacement('/lancamento/novo'), child: const Text('Preencher à mão')),
        ],
      );

  Widget _review() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_imagePath != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.file(File(_imagePath!), height: 180, fit: BoxFit.cover, width: double.infinity),
            ),
          const SizedBox(height: 16),
          if (_readError != null)
            LacoCard(
              color: LacoColors.douradoClaro,
              borderColor: LacoColors.dourado,
              child: Text(_readError!, style: const TextStyle(color: LacoColors.douradoTexto)),
            )
          else
            Row(children: [
              Icon(_data.fromQr ? Icons.qr_code_2 : Icons.text_fields, size: 18, color: LacoColors.apoio),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _data.fromQr ? 'Dados lidos do QR Code. Confira antes de seguir.' : 'Dados lidos do texto da nota. Confira com atenção.',
                  style: const TextStyle(color: LacoColors.apoio),
                ),
              ),
            ]),
          const SizedBox(height: 16),
          TextField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            decoration: AppTheme.input('Valor total', prefix: const Padding(padding: EdgeInsets.all(14), child: Text(r'R$', style: TextStyle(fontWeight: FontWeight.w700)))),
          ),
          if (_data.amountCandidates.length > 1) ...[
            const SizedBox(height: 8),
            const Text('Outros valores na nota:', style: TextStyle(color: LacoColors.apoio, fontSize: 13)),
            const SizedBox(height: 4),
            Wrap(spacing: 8, runSpacing: 4, children: [
              for (final c in _data.amountCandidates)
                ActionChip(label: Text(Money.format(c)), onPressed: () => setState(() => _amount.text = Money.toInput(c))),
            ]),
          ],
          const SizedBox(height: 14),
          TextField(controller: _merchant, textCapitalization: TextCapitalization.words, decoration: AppTheme.input('Estabelecimento')),
          const SizedBox(height: 14),
          InkWell(
            onTap: _pickDate,
            borderRadius: BorderRadius.circular(12),
            child: InputDecorator(decoration: AppTheme.input('Data da compra'), child: Text(Dates.format(_date))),
          ),
          if (_data.cnpj != null) ...[
            const SizedBox(height: 10),
            Text('CNPJ ${formatCnpj(_data.cnpj!)}', style: const TextStyle(color: LacoColors.apoio, fontSize: 13)),
          ],
          const SizedBox(height: 24),
          FilledButton(onPressed: _continue, child: const Text('Continuar para o lançamento')),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () async {
              await _discardPhoto();
              setState(() {
                _imagePath = null;
                _stage = _Stage.intro;
              });
            },
            child: const Text('Tirar outra foto'),
          ),
        ],
      );
}

class _Tip extends StatelessWidget {
  const _Tip({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 20, color: LacoColors.apoio),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(color: LacoColors.tinta))),
        ]),
      );
}
