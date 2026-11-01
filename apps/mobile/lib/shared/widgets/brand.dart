import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../core/theme/laco_tokens.dart';

/// Símbolo do Laço (casa cuja base forma um laço). Fonte: packages/brand/logo.
class LacoSymbol extends StatelessWidget {
  const LacoSymbol({super.key, this.size = 40, this.inverse = false});
  final double size;
  final bool inverse;

  @override
  Widget build(BuildContext context) => SvgPicture.asset(
        inverse ? 'assets/brand/laco-simbolo-negativo.svg' : 'assets/brand/laco-simbolo.svg',
        width: size,
        height: size,
        semanticsLabel: 'Laço',
      );
}

class LacoLogo extends StatelessWidget {
  const LacoLogo({super.key, this.size = 36, this.inverse = false});
  final double size;
  final bool inverse;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          LacoSymbol(size: size, inverse: inverse),
          SizedBox(width: size * 0.25),
          Text(
            'Laço',
            style: TextStyle(fontSize: size * 0.72, fontWeight: FontWeight.w800, letterSpacing: -0.5, color: inverse ? LacoColors.fundo : LacoColors.verde),
          ),
        ],
      );
}
