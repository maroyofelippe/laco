import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Gera um PDF simples de extrato a partir de linhas (texto com colunas separadas por "|"). */
export async function makeStatementPdf(lines: string[], opts: { header?: string[] } = {}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  const write = (text: string) => {
    if (y < 60) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    const cols = text.split('|');
    const xs = [40, 110, 380, 480];
    cols.forEach((c, i) => page.drawText(c.trim(), { x: xs[i] ?? 40 + i * 100, y, size: 10, font }));
    y -= 16;
  };
  for (const h of opts.header ?? []) write(h);
  for (const l of lines) write(l);
  return Buffer.from(await pdf.save());
}

/** PDF sem texto (simula documento digitalizado). */
export async function makeBlankPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).drawRectangle({ x: 50, y: 50, width: 200, height: 100 });
  return Buffer.from(await pdf.save());
}
