// Leitura de nota fiscal (NFC-e / cupom) a partir do QR Code e do texto reconhecido
// pelo ML Kit. Dart puro, sem Flutter: testado em test/receipt_parser_test.dart.
//
// Nada aqui é gravado automaticamente: o resultado só pré-preenche o formulário de
// lançamento, que a pessoa confere e confirma.

import '../../core/util/text.dart';

// ------------------------------------------------------------------ chave de acesso
/// Chave de acesso de 44 dígitos (NF-e/NFC-e):
/// cUF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9) tpEmis(1) código(8) DV(1).
class AccessKey {
  AccessKey._(this.digits);
  final String digits;

  static AccessKey? tryParse(String raw) {
    final d = raw.replaceAll(RegExp(r'\D'), '');
    if (d.length != 44) return null;
    if (_mod11(d.substring(0, 43)) != int.parse(d[43])) return null;
    return AccessKey._(d);
  }

  int get uf => int.parse(digits.substring(0, 2));
  int get year => 2000 + int.parse(digits.substring(2, 4));
  int get month => int.parse(digits.substring(4, 6));
  String get cnpj => digits.substring(6, 20);
  String get model => digits.substring(20, 22); // 65 = NFC-e, 55 = NF-e
  String get number => digits.substring(25, 34);
  bool get isNfce => model == '65';

  /// Dígito verificador: pesos 2..9 da direita para a esquerda; resto 0 ou 1 → 0.
  static int _mod11(String body) {
    var sum = 0;
    var w = 2;
    for (var i = body.length - 1; i >= 0; i--) {
      sum += int.parse(body[i]) * w;
      w = w == 9 ? 2 : w + 1;
    }
    final r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  }
}

// ------------------------------------------------------------------ resultado
class ReceiptData {
  const ReceiptData({this.amount, this.date, this.merchant, this.cnpj, this.accessKey, this.fromQr = false, this.amountCandidates = const []});

  /// Valor decimal "123.45".
  final String? amount;

  /// Data 'YYYY-MM-DD'.
  final String? date;
  final String? merchant;

  /// Só dígitos (14).
  final String? cnpj;
  final AccessKey? accessKey;

  /// Valor/data vieram do QR Code (mais confiável que o texto).
  final bool fromQr;

  /// Outros valores encontrados, para a pessoa escolher se o total estiver errado.
  final List<String> amountCandidates;

  bool get isEmpty => amount == null && date == null && merchant == null && cnpj == null;

  /// O QR tem prioridade em valor/data; o texto completa o que faltar.
  ReceiptData merge(ReceiptData other) => ReceiptData(
        amount: amount ?? other.amount,
        date: date ?? other.date,
        merchant: merchant ?? other.merchant,
        cnpj: cnpj ?? other.cnpj,
        accessKey: accessKey ?? other.accessKey,
        fromQr: fromQr || other.fromQr,
        amountCandidates: {...amountCandidates, ...other.amountCandidates}.toList(),
      );
}

// ------------------------------------------------------------------ QR Code
/// Interpreta o conteúdo do QR Code da NFC-e.
///
/// * v2/v3 online:  `...?p=CHAVE|2|1|1|HASH` — só a chave (mês/ano e CNPJ).
/// * v2/v3 offline (contingência): `p=CHAVE|2|1|DIA|VALOR|...` — traz dia e total.
/// * v1 (antigo): `?chNFe=...&vNF=12.34&dhEmi=<hex>...`.
///
/// Retorna null se não parecer uma NFC-e.
ReceiptData? parseNfceQr(String raw) {
  final text = raw.trim();
  // Sem Uri.parse: QR de alguns estados traz '|' e espaços que não são URL válida.
  String? param(String name) {
    final m = RegExp('[?&]$name=([^&#\\s]+)').firstMatch(text);
    if (m == null) return null;
    try {
      return Uri.decodeComponent(m[1]!);
    } catch (_) {
      return m[1];
    }
  }

  // v1
  final chNFe = param('chNFe');
  if (chNFe != null) {
    final key = AccessKey.tryParse(chNFe);
    if (key == null) return null;
    final amount = _decimalFromDot(param('vNF'));
    String? date;
    final dh = param('dhEmi');
    if (dh != null) {
      final decoded = _hexToAscii(dh) ?? dh;
      final m = RegExp(r'(\d{4})-(\d{2})-(\d{2})').firstMatch(decoded);
      if (m != null) date = '${m[1]}-${m[2]}-${m[3]}';
    }
    return ReceiptData(accessKey: key, cnpj: key.cnpj, amount: amount, date: date, fromQr: amount != null || date != null);
  }

  // v2/v3: parâmetro p (ou o texto inteiro, se a leitura vier só com a parte de dados)
  final p = param('p') ?? (text.contains('|') ? text : null);
  if (p == null) {
    final key = AccessKey.tryParse(text);
    return key == null ? null : ReceiptData(accessKey: key, cnpj: key.cnpj);
  }
  final parts = p.split('|');
  final key = AccessKey.tryParse(parts.first);
  if (key == null) return null;

  String? amount;
  String? date;
  // Offline: chave|versão|ambiente|dia|valor|...
  if (parts.length >= 5 && parts[4].length <= 12) {
    final day = int.tryParse(parts[3]);
    final value = _decimalFromDot(parts[4]);
    if (day != null && day >= 1 && day <= 31 && value != null) {
      amount = value;
      date = _safeDate(key.year, key.month, day);
    }
  }
  return ReceiptData(accessKey: key, cnpj: key.cnpj, amount: amount, date: date, fromQr: amount != null);
}

String? _safeDate(int y, int m, int d) {
  final dt = DateTime(y, m, d);
  if (dt.month != m) return null; // 31/02 etc.
  return '${y.toString().padLeft(4, '0')}-${m.toString().padLeft(2, '0')}-${d.toString().padLeft(2, '0')}';
}

String? _decimalFromDot(String? v) {
  if (v == null) return null;
  final m = RegExp(r'^\d+(\.\d{1,2})?$').firstMatch(v.trim());
  if (m == null) return null;
  final parts = v.trim().split('.');
  final cents = int.parse(parts[0]) * 100 + int.parse(('${parts.length > 1 ? parts[1] : ''}00').substring(0, 2));
  if (cents <= 0) return null;
  return '${cents ~/ 100}.${(cents % 100).toString().padLeft(2, '0')}';
}

String? _hexToAscii(String hex) {
  if (hex.length.isOdd || !RegExp(r'^[0-9a-fA-F]+$').hasMatch(hex)) return null;
  final b = StringBuffer();
  for (var i = 0; i < hex.length; i += 2) {
    b.writeCharCode(int.parse(hex.substring(i, i + 2), radix: 16));
  }
  return b.toString();
}

// ------------------------------------------------------------------ texto (OCR)
final _amountRe = RegExp(r'(?<![\d,.])(\d{1,3}(?:\.\d{3})*|\d+)\s?,\s?(\d{2})(?!\d)');
final _dateRe = RegExp(r'(?<!\d)(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})(?!\d)');
final _cnpjRe = RegExp(r'(?<!\d)(\d{2})\.?(\d{3})\.?(\d{3})\s?/?\s?(\d{4})\s?-?\s?(\d{2})(?!\d)');

/// Extrai total, data, CNPJ e estabelecimento do texto reconhecido de um cupom.
ReceiptData parseReceiptText(String text, {DateTime? now}) {
  final today = now ?? DateTime.now();
  final lines = text.split(RegExp(r'\r?\n')).map((l) => l.trim()).where((l) => l.isNotEmpty).toList();
  final norm = lines.map((l) => normalizeText(l).toUpperCase()).toList();

  // ---- total: rótulos em ordem de confiança; valor na mesma linha ou na seguinte
  const labels = [
    ['VALOR A PAGAR', 'VALOR PAGO', 'VALOR TOTAL A PAGAR'],
    ['VALOR TOTAL', 'TOTAL R\$', 'TOTAL GERAL', 'TOTAL A PAGAR'],
    ['TOTAL'],
  ];
  const excluded = ['TROCO', 'DESCONTO', 'DESC.', 'QTD', 'QTDE', 'ITENS', 'TRIBUT', 'APROX', 'LEI 12.741', 'IBPT', 'SUBTOTAL', 'ACRESC'];
  String? amount;
  for (final group in labels) {
    for (var i = 0; i < norm.length && amount == null; i++) {
      final l = norm[i];
      if (!group.any(l.contains)) continue;
      if (excluded.any(l.contains)) continue;
      amount = _lastAmount(lines[i]) ?? (i + 1 < lines.length && !excluded.any(norm[i + 1].contains) ? _lastAmount(lines[i + 1]) : null);
    }
    if (amount != null) break;
  }

  final candidates = <String>{};
  for (final l in lines) {
    for (final m in _amountRe.allMatches(l)) {
      final v = _amountFromMatch(m);
      if (v != null) candidates.add(v);
    }
  }
  final sortedCandidates = candidates.toList()..sort((a, b) => _cents(b).compareTo(_cents(a)));

  // ---- data: preferir linha de emissão; descartar datas futuras ou muito antigas
  String? date;
  String? firstDate;
  for (var i = 0; i < lines.length; i++) {
    for (final m in _dateRe.allMatches(lines[i])) {
      final d = _dateFromMatch(m, today);
      if (d == null) continue;
      firstDate ??= d;
      if (norm[i].contains('EMISS') || norm[i].contains('DATA')) {
        date ??= d;
      }
    }
  }
  date ??= firstDate;

  // ---- CNPJ (com dígitos verificadores válidos)
  String? cnpj;
  for (final l in lines) {
    for (final m in _cnpjRe.allMatches(l)) {
      final d = '${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}';
      if (isValidCnpj(d)) {
        cnpj = d;
        break;
      }
    }
    if (cnpj != null) break;
  }

  // ---- estabelecimento: primeiras linhas "de nome", ignorando cabeçalhos fiscais
  String? merchant;
  const skip = [
    'DANFE', 'NFC-E', 'NFCE', 'NFC E', 'CUPOM', 'DOCUMENTO', 'AUXILIAR', 'CNPJ', 'CPF', 'I.E', 'IE:', 'INSCR', 'ENDERECO',
    'RUA ', 'R. ', 'AV ', 'AV.', 'AVENIDA', 'ROD ', 'EXTRATO', 'CF-E', 'SAT ', 'FISCAL', 'NOTA', 'CONSUMIDOR', 'ELETRONICA', 'TEL:', 'TEL.', 'FONE', 'CEP',
    'BAIRRO', 'CONSULTE', 'CHAVE', 'PROTOCOLO', 'EMISSAO', 'VIA ', 'TOTAL', 'VALOR', 'TROCO', 'DINHEIRO', 'CARTAO',
  ];
  for (var i = 0; i < lines.length && i < 8; i++) {
    final l = norm[i];
    if (skip.any(l.contains) || _amountRe.hasMatch(lines[i])) continue;
    final letters = RegExp(r'[A-Z]').allMatches(l).length;
    final digits = RegExp(r'\d').allMatches(l).length;
    if (letters < 3 || digits > letters / 2) continue;
    merchant = _titleCase(lines[i].replaceAll(RegExp(r'\s+'), ' '));
    break;
  }

  return ReceiptData(amount: amount, date: date, merchant: merchant, cnpj: cnpj, amountCandidates: sortedCandidates.take(6).toList());
}

String? _lastAmount(String line) {
  final all = _amountRe.allMatches(line).toList();
  if (all.isEmpty) return null;
  return _amountFromMatch(all.last);
}

String? _amountFromMatch(RegExpMatch m) {
  final reais = int.tryParse(m[1]!.replaceAll('.', ''));
  if (reais == null) return null;
  final cents = reais * 100 + int.parse(m[2]!);
  if (cents <= 0) return null;
  return '${cents ~/ 100}.${(cents % 100).toString().padLeft(2, '0')}';
}

int _cents(String v) {
  final p = v.split('.');
  return int.parse(p[0]) * 100 + int.parse(p[1]);
}

String? _dateFromMatch(RegExpMatch m, DateTime today) {
  final d = int.parse(m[1]!);
  final mo = int.parse(m[2]!);
  var y = int.parse(m[3]!);
  if (m[3]!.length == 2) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  final iso = _safeDate(y, mo, d);
  if (iso == null) return null;
  final dt = DateTime(y, mo, d);
  final todayDate = DateTime(today.year, today.month, today.day);
  if (dt.isAfter(todayDate.add(const Duration(days: 1)))) return null;
  if (dt.isBefore(todayDate.subtract(const Duration(days: 730)))) return null;
  return iso;
}

String _titleCase(String s) {
  const lower = {'de', 'da', 'do', 'das', 'dos', 'e'};
  const upper = {'LTDA', 'ME', 'EIRELI', 'SA', 'S/A', 'EPP'};
  final words = s.split(' ');
  return [
    for (var i = 0; i < words.length; i++)
      if (upper.contains(words[i].toUpperCase().replaceAll('.', '')))
        words[i].toUpperCase()
      else if (i > 0 && lower.contains(words[i].toLowerCase()))
        words[i].toLowerCase()
      else if (words[i].isEmpty)
        words[i]
      else
        words[i][0].toUpperCase() + words[i].substring(1).toLowerCase(),
  ].join(' ');
}

/// CNPJ com os dois dígitos verificadores corretos.
bool isValidCnpj(String digits) {
  final d = digits.replaceAll(RegExp(r'\D'), '');
  if (d.length != 14 || RegExp(r'^(\d)\1{13}$').hasMatch(d)) return false;
  int dv(String body, List<int> weights) {
    var s = 0;
    for (var i = 0; i < weights.length; i++) {
      s += int.parse(body[i]) * weights[i];
    }
    final r = s % 11;
    return r < 2 ? 0 : 11 - r;
  }

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(d, w1) == int.parse(d[12]) && dv(d, w2) == int.parse(d[13]);
}

String formatCnpj(String d) => d.length != 14 ? d : '${d.substring(0, 2)}.${d.substring(2, 5)}.${d.substring(5, 8)}/${d.substring(8, 12)}-${d.substring(12)}';

// ------------------------------------------------------------------ categoria
/// Palavras do nome do estabelecimento → nomes de categoria (em ordem de preferência).
/// A tela procura esses nomes entre as categorias da família; a pessoa sempre confirma.
const _categoryHints = <String, List<String>>{
  'supermerc': ['Mercado'], 'mercado': ['Mercado'], 'atacad': ['Mercado'], 'hortifruti': ['Mercado'], 'sacolao': ['Mercado'],
  'acougue': ['Mercado'], 'padaria': ['Mercado', 'Alimentação fora'], 'panific': ['Mercado', 'Alimentação fora'],
  'restaurante': ['Restaurantes', 'Alimentação fora'], 'lanchonete': ['Restaurantes', 'Alimentação fora'], 'pizzaria': ['Restaurantes', 'Alimentação fora'],
  'bar ': ['Restaurantes', 'Alimentação fora'], 'cafe': ['Restaurantes', 'Alimentação fora'], 'sorvet': ['Alimentação fora'], 'burger': ['Restaurantes', 'Alimentação fora'],
  'farmac': ['Farmácia', 'Saúde'], 'drogaria': ['Farmácia', 'Saúde'], 'drogasil': ['Farmácia', 'Saúde'], 'pague menos': ['Farmácia', 'Saúde'],
  'posto': ['Combustível', 'Transporte'], 'combust': ['Combustível', 'Transporte'], 'auto posto': ['Combustível', 'Transporte'],
  'petrobras': ['Combustível', 'Transporte'], 'ipiranga': ['Combustível', 'Transporte'], 'shell': ['Combustível', 'Transporte'],
  'estacion': ['Transporte'], 'livraria': ['Educação'], 'papelaria': ['Educação'],
  'magazine': ['Outras despesas'], 'calcad': ['Vestuário'], 'confec': ['Vestuário'], 'moda': ['Vestuário'], 'roupa': ['Vestuário'],
  'materiais de constr': ['Manutenção', 'Moradia'], 'home center': ['Manutenção', 'Moradia'], 'ferrag': ['Manutenção', 'Moradia'],
  'cinema': ['Lazer'], 'pet shop': ['Outras despesas'], 'petshop': ['Outras despesas'],
};

/// Nomes de categoria sugeridos para o estabelecimento (vazio se nada combinar).
List<String> categoryHintsFor(String? merchant) {
  if (merchant == null) return const [];
  final m = ' ${normalizeText(merchant)} ';
  for (final e in _categoryHints.entries) {
    if (m.contains(e.key)) return e.value;
  }
  return const [];
}
