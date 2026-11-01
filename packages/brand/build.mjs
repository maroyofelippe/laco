// Gera tokens.css (web) e laco_tokens.dart (Flutter) a partir de tokens.json.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const t = JSON.parse(readFileSync(new URL('tokens.json', dir), 'utf8'));
const header = 'Gerado por packages/brand/build.mjs a partir de tokens.json — não edite à mão.';

const css = [
  `/* ${header} */`,
  ':root {',
  ...Object.entries(t.color).map(([k, v]) => `  --laco-${k}: ${v.value};`),
  ...t.chart.map((c, i) => `  --laco-chart-${i + 1}: ${c};`),
  `  --laco-font: ${t.font.family};`,
  ...Object.entries(t.radius).map(([k, v]) => `  --laco-radius-${k}: ${v};`),
  '}',
  '',
].join('\n');
writeFileSync(new URL('tokens.css', dir), css);

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const dart = [
  `// ${header}`,
  "import 'package:flutter/painting.dart';",
  '',
  'abstract final class LacoColors {',
  ...Object.entries(t.color).map(([k, v]) => `  /// ${v.use}\n  static const ${camel(k)} = Color(0xFF${v.value.slice(1).toUpperCase()});`),
  '',
  `  static const chart = <Color>[${t.chart.map((c) => `Color(0xFF${c.slice(1).toUpperCase()})`).join(', ')}];`,
  '}',
  '',
  'abstract final class LacoBrand {',
  `  static const name = '${t.brand.name}';`,
  `  static const tagline = '${t.brand.tagline}';`,
  `  static const promise = '${t.brand.promise}';`,
  '}',
  '',
].join('\n');
// Usado pelo app Flutter (apps/mobile); não gerar em packages/brand, que não é um pacote Dart
writeFileSync(new URL('../../apps/mobile/lib/core/theme/laco_tokens.dart', dir), dart);
console.log('tokens.css e apps/mobile/lib/core/theme/laco_tokens.dart gerados');
