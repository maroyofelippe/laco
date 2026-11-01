import 'package:flutter/painting.dart';

import '../theme/laco_tokens.dart';

/// "#5B8E7D" → Color. Cor ausente/inválida usa o cinza esverdeado da marca.
Color hexColor(String? hex) {
  if (hex == null) return LacoColors.apoio;
  final h = hex.replaceAll('#', '');
  if (h.length != 6) return LacoColors.apoio;
  final v = int.tryParse(h, radix: 16);
  return v == null ? LacoColors.apoio : Color(0xFF000000 | v);
}
