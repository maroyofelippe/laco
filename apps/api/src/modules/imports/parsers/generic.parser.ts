import { normalizeDescription } from '../../../common/util';
import type { PdfDocument } from './pdf-text';
import type { ParseContext, ParsedLine, StatementParser } from './types';

/** Valor no formato brasileiro, com sinal/indicador opcionais: -1.234,56 · 1.234,56- · R$ 58,90 · 120,00 D */
const AMOUNT = /(-\s?)?(?:R\$\s?)?(\d{1,3}(?:\.\d{3})*,\d{2})(\s?-|\s?[DC]\b)?/g;
const DATE_START = /^(\d{2})[/.-](\d{2})(?:[/.-](\d{2,4}))?\b/;
const DATE_WORD = /^(\d{2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/i;
const FULL_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

// Linhas que não são lançamentos
const SKIP_COMMON = /\b(saldo|total|subtotal|resumo|limite (dispon|total|de cr)|valor m[ií]nimo|vencimento|per[ií]odo|data de|cliente|ag[eê]ncia|conta corrente n|cpf|cnpj)\b/i;
const SKIP_CARD = /\b(pagamento (recebido|efetuado|de fatura|obrigado)|pgto fatura|fatura anterior|cr[eé]dito de pagamento)\b/i;
const INCOME_HINT = /\b(pix recebido|recebid[oa]|transf(er[eê]ncia)? recebida|ted recebida|doc recebido|sal[aá]rio|dep[oó]sito|rendimento|estorno|cr[eé]dito|reembolso|cashback|devolu[cç][aã]o)\b/i;

const parseAmount = (s: string) => s.replace(/\./g, '').replace(',', '.');

export const genericParser: StatementParser = {
  id: 'generic@1',
  bank: null,

  detect: () => 0.1, // aceita qualquer PDF com texto; perde para parsers específicos

  parse(doc: PdfDocument, ctx: ParseContext): ParsedLine[] {
    const ref = referenceDate(doc, ctx.today);
    const out: ParsedLine[] = [];
    doc.lines.forEach((line, idx) => {
      const text = line.text;
      const parsed = parseDate(text, ref);
      if (!parsed) return;
      if (SKIP_COMMON.test(text)) return;
      if (ctx.sourceType === 'CARD_STATEMENT' && SKIP_CARD.test(text)) return;

      const rest = text.slice(parsed.length).trim();
      const amounts = [...rest.matchAll(AMOUNT)];
      if (!amounts.length) return;
      // Extratos de conta costumam trazer o saldo na última coluna: usa o 1º valor; fatura: o último
      const chosen = ctx.sourceType !== 'CARD_STATEMENT' && amounts.length > 1 ? amounts[0] : amounts[amounts.length - 1];
      const negative = !!chosen[1] || /-/.test(chosen[3] ?? '') || /D/.test(chosen[3] ?? '');
      const creditMark = /C/.test(chosen[3] ?? '');
      let description = rest.slice(0, chosen.index).replace(/\s+/g, ' ').trim();
      description = description.replace(/\bR\$\s*$/, '').trim();
      const inst = description.match(/\b(\d{1,2})\s?\/\s?(\d{1,2})\s*$/) ?? description.match(/\bparc(?:ela)?\.?\s*(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})\b/i);
      const installmentHint = inst && Number(inst[1]) <= Number(inst[2]) ? `${inst[1].padStart(2, '0')}/${inst[2].padStart(2, '0')}` : null;

      let type: 'INCOME' | 'EXPENSE';
      if (ctx.sourceType === 'CARD_STATEMENT') type = negative || INCOME_HINT.test(description) ? 'INCOME' : 'EXPENSE';
      else type = negative ? 'EXPENSE' : creditMark || INCOME_HINT.test(description) ? 'INCOME' : 'EXPENSE';

      let confidence = 0.9;
      if (!description || normalizeDescription(description).length < 3) confidence -= 0.3;
      if (parsed.yearInferred) confidence -= 0.05;
      if (ctx.sourceType !== 'CARD_STATEMENT' && !negative && !creditMark && !INCOME_HINT.test(description)) confidence -= 0.15; // tipo deduzido

      out.push({
        lineNo: idx + 1,
        raw: text.slice(0, 500),
        occurredOn: parsed.date,
        description: description || null,
        amount: parseAmount(chosen[2]),
        type,
        installmentHint,
        confidence: Math.max(0.1, Math.round(confidence * 100) / 100),
      });
    });
    return out;
  },
};

/** Data de referência do documento: a maior data completa encontrada que não esteja no futuro distante. */
function referenceDate(doc: PdfDocument, today: string): string {
  const limit = addDaysIso(today, 60);
  const dates = [...doc.fullText.matchAll(FULL_DATE)]
    .map((m) => `${m[3]}-${m[2]}-${m[1]}`)
    .filter((d) => isValidIso(d) && d <= limit);
  return dates.length ? dates.sort().at(-1)! : today;
}

function parseDate(text: string, ref: string): { date: string; length: number; yearInferred: boolean } | null {
  let m = text.match(DATE_START);
  let day: number;
  let month: number;
  let year: number | null = null;
  if (m) {
    day = Number(m[1]);
    month = Number(m[2]);
    if (m[3]) year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else {
    m = text.match(DATE_WORD);
    if (!m) return null;
    day = Number(m[1]);
    month = MONTHS.indexOf(m[2].toUpperCase()) + 1;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let inferred = false;
  if (year === null) {
    // Sem ano: assume o ano da referência; se cair depois dela (ex.: dezembro num extrato de janeiro), ano anterior
    inferred = true;
    const [ry] = ref.split('-').map(Number);
    year = ry;
    if (toIso(year, month, day) > addDaysIso(ref, 7)) year -= 1;
  }
  const iso = toIso(year, month, day);
  if (!isValidIso(iso)) return null;
  return { date: iso, length: m[0].length, yearInferred: inferred };
}

const toIso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function isValidIso(d: string) {
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}
function addDaysIso(d: string, n: number) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
