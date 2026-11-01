import { genericParser } from './generic.parser';
import type { PdfDocument } from './pdf-text';
import type { ParseContext, StatementParser } from './types';

/**
 * Parsers específicos por banco entram aqui (ex.: nubank-card@1, itau-checking@1), cada um com
 * PDFs anonimizados de referência e teste de regressão. O genérico fica por último.
 */
export const PARSERS: StatementParser[] = [genericParser];

export function pickParser(doc: PdfDocument, ctx: ParseContext): StatementParser {
  const scored = PARSERS.map((p) => ({ p, score: p.detect(doc, ctx) })).sort((a, b) => b.score - a.score);
  const specific = scored.find((s) => s.p.bank && s.score >= 0.7);
  return specific?.p ?? genericParser;
}
