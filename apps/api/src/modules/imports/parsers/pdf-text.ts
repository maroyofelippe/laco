/**
 * Extrai o texto de um PDF agrupado em linhas, usando as coordenadas de cada trecho.
 * pdfjs-dist 3.x (build CJS "legacy"). Só lemos texto: isEvalSupported=false e
 * disableFontFace=true neutralizam a execução de código via fontes (CVE-2024-4367).
 */
// O build legacy avisa no carregamento que não há "canvas" (só necessário para renderizar): silenciamos.
const pdfjs = (() => {
  const { log, warn } = console;
  console.log = console.warn = () => undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('pdfjs-dist/legacy/build/pdf.js') as typeof import('pdfjs-dist');
  } finally {
    console.log = log;
    console.warn = warn;
  }
})();

export interface PdfLine {
  page: number;
  y: number;
  text: string;
  /** Trechos com posição x, para parsers que precisam de colunas. */
  cells: { x: number; text: string }[];
}

export interface PdfDocument {
  pages: number;
  lines: PdfLine[];
  fullText: string;
  /** true quando quase não há texto: provavelmente digitalizado (imagem). */
  looksScanned: boolean;
}

export class PdfPasswordError extends Error {
  constructor(public readonly reason: 'REQUIRED' | 'INVALID') {
    super(reason);
  }
}

export async function extractPdf(data: Buffer, password?: string): Promise<PdfDocument> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    password,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err.name === 'PasswordException') throw new PdfPasswordError(err.code === 2 ? 'INVALID' : 'REQUIRED');
    throw e;
  }
  const lines: PdfLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items as { str: string; transform: number[] }[])
        .filter((i) => typeof i.str === 'string' && i.str.trim() !== '')
        .map((i) => ({ x: i.transform[4], y: i.transform[5], text: i.str }));
      // Agrupa por linha com tolerância de 2,5 pt no eixo y (de cima para baixo)
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const pageLines: PdfLine[] = [];
      for (const it of items) {
        const line = pageLines.find((l) => Math.abs(l.y - it.y) <= 2.5);
        if (line) line.cells.push({ x: it.x, text: it.text });
        else pageLines.push({ page: p, y: it.y, text: '', cells: [{ x: it.x, text: it.text }] });
      }
      for (const l of pageLines) {
        l.cells.sort((a, b) => a.x - b.x);
        l.text = l.cells.map((c) => c.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
        lines.push(l);
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  const fullText = lines.map((l) => l.text).join('\n');
  return { pages: doc.numPages, lines, fullText, looksScanned: fullText.replace(/\s/g, '').length < 20 * Math.max(1, doc.numPages) };
}
