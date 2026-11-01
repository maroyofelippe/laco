import type { PdfDocument } from './pdf-text';

export type SourceType = 'CARD_STATEMENT' | 'CHECKING' | 'SAVINGS';

export interface ParseContext {
  sourceType: SourceType;
  /** Data de hoje (YYYY-MM-DD), usada para inferir o ano de datas "dd/mm". */
  today: string;
}

export interface ParsedLine {
  lineNo: number;
  raw: string;
  occurredOn: string | null;
  description: string | null;
  amount: string | null; // decimal positivo, ex.: "58.90"
  type: 'INCOME' | 'EXPENSE' | null;
  installmentHint: string | null; // ex.: "03/10"
  confidence: number; // 0..1
}

/**
 * Bancos usam layouts diferentes: cada parser declara quanto "reconhece" o documento
 * (detect → 0..1) e o registro escolhe o de maior pontuação. O genérico é o último recurso.
 */
export interface StatementParser {
  id: string; // ex.: 'generic@1', 'nubank-card@1'
  bank: string | null;
  detect(doc: PdfDocument, ctx: ParseContext): number;
  parse(doc: PdfDocument, ctx: ParseContext): ParsedLine[];
}
