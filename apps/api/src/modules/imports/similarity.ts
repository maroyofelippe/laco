/** Similaridade Jaro-Winkler (0..1) entre duas strings já normalizadas. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Palavras que variam entre extratos e não identificam o estabelecimento. */
const NOISE = new Set(['parc', 'parcela', 'parcelado', 'compra', 'pag', 'pagto', 'deb', 'cred']);

/** Padrão usado nas regras aprendidas: as 3 primeiras palavras significativas da descrição. */
export function rulePattern(normalized: string): string {
  return normalized
    .split(' ')
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !NOISE.has(w))
    .slice(0, 3)
    .join(' ')
    .slice(0, 120);
}
