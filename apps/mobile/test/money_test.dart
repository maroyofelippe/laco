import 'package:flutter_test/flutter_test.dart';
import 'package:laco/core/util/money.dart';

void main() {
  test('toCents / fromCents sem ponto flutuante', () {
    expect(Money.toCents('125.90'), 12590);
    expect(Money.toCents('-0.05'), -5);
    expect(Money.toCents('10'), 1000);
    expect(Money.toCents('10.5'), 1050);
    expect(Money.fromCents(12590), '125.90');
    expect(Money.fromCents(-5), '-0.05');
  });

  test('parseInput aceita os formatos que as pessoas digitam', () {
    expect(Money.parseInput('1.234,56'), '1234.56');
    expect(Money.parseInput('R\$ 89,90'), '89.90');
    expect(Money.parseInput('89.90'), '89.90');
    expect(Money.parseInput('1.234'), '1234.00');
    expect(Money.parseInput('12,5'), '12.50');
    expect(Money.parseInput('0'), isNull);
    expect(Money.parseInput('abc'), isNull);
    expect(Money.parseInput(''), isNull);
  });

  test('format em reais', () {
    expect(Money.format('1234.56'), contains('1.234,56'));
    expect(Money.toInput('1234.5'), '1.234,50');
  });
}
