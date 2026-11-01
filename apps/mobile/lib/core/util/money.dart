import 'package:intl/intl.dart';

/// Valores trafegam como string decimal ("125.90"). Contas em centavos inteiros, sem double.
abstract final class Money {
  static final _brl = NumberFormat.currency(locale: 'pt_BR', symbol: r'R$');
  static final _brlShort = NumberFormat.compactCurrency(locale: 'pt_BR', symbol: r'R$', decimalDigits: 0);

  static int toCents(String? v) {
    if (v == null || v.isEmpty) return 0;
    final neg = v.startsWith('-');
    final parts = v.replaceAll('-', '').split('.');
    final cents = int.parse(parts[0]) * 100 + int.parse(('${parts.length > 1 ? parts[1] : ''}00').substring(0, 2));
    return neg ? -cents : cents;
  }

  static String fromCents(int c) {
    final neg = c < 0;
    final a = c.abs();
    return '${neg ? '-' : ''}${a ~/ 100}.${(a % 100).toString().padLeft(2, '0')}';
  }

  static String format(String? v) => _brl.format(toCents(v) / 100);
  static String formatCents(int c) => _brl.format(c / 100);
  static String compact(num reais) => _brlShort.format(reais);

  /// Entrada digitada ("1.234,56", "1234,5", "R$ 89,90", "89.90") → "1234.56". null se inválida ou zero.
  static String? parseInput(String input) {
    var s = input.trim().replaceAll(RegExp(r'[R$\s]'), '');
    if (s.isEmpty) return null;
    if (s.contains(',')) {
      s = s.replaceAll('.', '').replaceAll(',', '.');
    } else if (RegExp(r'^\d{1,3}(\.\d{3})+$').hasMatch(s)) {
      s = s.replaceAll('.', ''); // "1.234" = mil duzentos e trinta e quatro
    }
    if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(s)) return null;
    final parts = s.split('.');
    final cents = int.parse(parts[0]) * 100 + int.parse(('${parts.length > 1 ? parts[1] : ''}00').substring(0, 2));
    if (cents <= 0) return null;
    return fromCents(cents);
  }

  /// "1234.56" → "1.234,56" para preencher campos.
  static String toInput(String? v) {
    if (v == null || v.isEmpty) return '';
    return NumberFormat.decimalPatternDigits(locale: 'pt_BR', decimalDigits: 2).format(toCents(v) / 100);
  }
}
