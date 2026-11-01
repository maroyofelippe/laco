import 'package:flutter_test/flutter_test.dart';
import 'package:laco/features/receipt/receipt_parser.dart';

// Chave fictícia com DV correto (UF 35, 09/2026, CNPJ 11.222.333/0001-81, modelo 65).
const key = '35260911222333000181650010000123451876543210';

void main() {
  group('AccessKey', () {
    test('valida o dígito verificador e extrai os campos', () {
      final k = AccessKey.tryParse(key)!;
      expect(k.uf, 35);
      expect(k.year, 2026);
      expect(k.month, 9);
      expect(k.cnpj, '11222333000181');
      expect(k.isNfce, isTrue);
    });

    test('aceita a chave com espaços e recusa DV errado', () {
      expect(AccessKey.tryParse('3526 0911 2223 3300 0181 6500 1000 0123 4518 7654 3210'), isNotNull);
      expect(AccessKey.tryParse('${key.substring(0, 43)}1'), isNull);
      expect(AccessKey.tryParse('123'), isNull);
    });
  });

  group('parseNfceQr', () {
    test('QR online (v2) traz só a chave', () {
      final r = parseNfceQr('https://www.nfce.fazenda.sp.gov.br/qrcode?p=$key|2|1|1|0123456789ABCDEF0123456789ABCDEF01234567')!;
      expect(r.accessKey!.digits, key);
      expect(r.cnpj, '11222333000181');
      expect(r.amount, isNull);
      expect(r.fromQr, isFalse);
    });

    test('QR de contingência (offline) traz dia e valor', () {
      final r = parseNfceQr('https://www.sefaz.mt.gov.br/nfce/consultanfce?p=$key|2|2|14|40.00|6a6f|1|ABCDEF')!;
      expect(r.amount, '40.00');
      expect(r.date, '2026-09-14');
      expect(r.fromQr, isTrue);
    });

    test('QR antigo (v1) com dhEmi em hexadecimal', () {
      final r = parseNfceQr(
        'http://nfce.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?chNFe=$key&nVersao=100&tpAmb=1'
        '&dhEmi=323032362d30392d31345431383a33323a31302d30333a3030&vNF=40.00&vICMS=0.00&digVal=x&cIdToken=000001&cHashQRCode=y',
      )!;
      expect(r.amount, '40.00');
      expect(r.date, '2026-09-14');
    });

    test('ignora QR que não é de nota fiscal', () {
      expect(parseNfceQr('https://example.com/promo'), isNull);
      expect(parseNfceQr('https://x.gov.br/qrcode?p=${key.substring(0, 43)}9|2|1|1|abc'), isNull);
    });
  });

  group('parseReceiptText', () {
    final now = DateTime(2026, 10, 27);

    test('cupom típico: valor a pagar, data de emissão, CNPJ e estabelecimento', () {
      const text = '''
SUPERMERCADO BOM PRECO LTDA
CNPJ: 11.222.333/0001-81 IE: 123456
RUA DAS FLORES, 100 - CENTRO
DANFE NFC-e - Documento Auxiliar
ARROZ 5KG 1 UN X 24,90 24,90
FEIJAO 2 UN X 8,50 17,00
QTD. TOTAL DE ITENS 3
VALOR TOTAL R\$ 41,90
DESCONTO R\$ 1,90
VALOR A PAGAR R\$ 40,00
Dinheiro 50,00
Troco R\$ 10,00
EMISSAO: 14/10/2026 18:32:10
''';
      final r = parseReceiptText(text, now: now);
      expect(r.amount, '40.00');
      expect(r.date, '2026-10-14');
      expect(r.cnpj, '11222333000181');
      expect(r.merchant, 'Supermercado Bom Preco LTDA');
      expect(r.amountCandidates, contains('41.90'));
    });

    test('valor na linha seguinte ao rótulo TOTAL', () {
      final r = parseReceiptText('PADARIA PAO QUENTE\nTOTAL\n89,90', now: now);
      expect(r.amount, '89.90');
      expect(r.merchant, 'Padaria Pao Quente');
    });

    test('não confunde troco com total', () {
      final r = parseReceiptText('TOTAL R\$ 30,00\nTROCO R\$ 20,00', now: now);
      expect(r.amount, '30.00');
    });

    test('valores com milhar', () {
      final r = parseReceiptText('VALOR A PAGAR R\$ 1.234,56', now: now);
      expect(r.amount, '1234.56');
    });

    test('descarta datas futuras', () {
      final r = parseReceiptText('DATA 01/01/2030\nEMISSAO 20/10/2026', now: now);
      expect(r.date, '2026-10-20');
    });

    test('texto sem dados', () {
      final r = parseReceiptText('foto borrada', now: now);
      expect(r.amount, isNull);
      expect(r.date, isNull);
    });
  });

  group('merge, CNPJ e categoria', () {
    test('QR tem prioridade e o texto completa', () {
      final qr = parseNfceQr('https://x.gov.br/qrcode?p=$key|2|2|14|40.00|aa|1|bb')!;
      final txt = parseReceiptText('MERCADINHO DA ESQUINA\nTOTAL 39,00', now: DateTime(2026, 10, 27));
      final m = qr.merge(txt);
      expect(m.amount, '40.00');
      expect(m.merchant, 'Mercadinho da Esquina');
      expect(m.fromQr, isTrue);
    });

    test('isValidCnpj', () {
      expect(isValidCnpj('11.222.333/0001-81'), isTrue);
      expect(isValidCnpj('11222333000182'), isFalse);
      expect(isValidCnpj('00000000000000'), isFalse);
      expect(formatCnpj('11222333000181'), '11.222.333/0001-81');
    });

    test('sugestão de categoria pelo nome', () {
      expect(categoryHintsFor('Drogaria São Paulo'), contains('Farmácia'));
      expect(categoryHintsFor('Auto Posto Avenida'), contains('Combustível'));
      expect(categoryHintsFor('Supermercado Bom Preço').first, 'Mercado');
      expect(categoryHintsFor('Loja Qualquer'), isEmpty);
    });
  });
}
