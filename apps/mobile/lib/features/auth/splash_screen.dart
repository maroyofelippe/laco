import 'package:flutter/material.dart';

import '../../shared/widgets/brand.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [LacoSymbol(size: 72), SizedBox(height: 24), CircularProgressIndicator()])),
      );
}
