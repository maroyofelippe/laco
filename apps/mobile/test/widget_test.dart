import 'package:flutter_test/flutter_test.dart';

import 'package:laco/core/theme/laco_tokens.dart';

void main() {
  test('tokens da marca estão definidos', () {
    expect(LacoBrand.name, 'Laço');
    expect(LacoColors.chart, isNotEmpty);
  });
}
