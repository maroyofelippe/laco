import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';

export const newId = (): string => uuidv7();
export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

// ---------------------------------------------------------------- Dinheiro
// Valores trafegam como string decimal ("125.90"); contas são feitas em centavos inteiros.
export const toCents = (v: string | number): number => {
  const s = typeof v === 'number' ? v.toFixed(2) : v;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Valor monetário inválido: ${s}`);
  const neg = s.startsWith('-');
  const [i, d = ''] = s.replace('-', '').split('.');
  const cents = Number(i) * 100 + Number((d + '00').slice(0, 2));
  return neg ? -cents : cents;
};
export const fromCents = (c: number): string => {
  const neg = c < 0;
  const abs = Math.abs(Math.round(c));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
/** Divide em n parcelas; a diferença de centavos vai para a primeira (100/3 = 33.34 + 33.33 + 33.33). */
export const splitInstallments = (total: string, n: number): string[] => {
  const cents = toCents(total);
  const base = Math.floor(cents / n);
  const first = cents - base * (n - 1);
  return [first, ...Array(n - 1).fill(base)].map(fromCents);
};

// ------------------------------------------------------------------ Datas
// Datas de negócio são 'YYYY-MM-DD' sem fuso; aritmética em UTC para não deslocar o dia.
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const today = (tz = 'America/Sao_Paulo'): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (d: string, n: number) => {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
};
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Soma meses mantendo o dia, limitado ao último dia do mês (31/01 + 1 = 28/02). */
export const addMonths = (d: string, n: number, day?: number) => {
  const [y, m, dd] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(day ?? dd, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
};
export const monthOf = (d: string) => d.slice(0, 7);
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const monthEnd = (d: string) => {
  const [y, m] = d.split('-').map(Number);
  return `${d.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
};
export const weekStart = (d: string) => {
  const x = parse(d);
  const dow = (x.getUTCDay() + 6) % 7; // segunda = 0
  return addDays(d, -dow);
};
export const dateInMonth = (ym: string, day: number) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`;
};
export const isoNow = () => new Date().toISOString().replace('T', ' ').replace('Z', '');

// ------------------------------------------------------------------ Texto
/** Minúsculas, sem acentos, sem pontuação e sem números de parcela — usado em busca e duplicatas. */
export const normalizeDescription = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

// ----------------------------------------------------------------- Cursor
export const encodeCursor = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const decodeCursor = <T>(c?: string): T | null => {
  if (!c) return null;
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
};

export const bool = (v: number | boolean | null | undefined) => v === true || v === 1;
