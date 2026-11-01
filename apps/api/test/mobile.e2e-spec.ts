import type { INestApplication } from '@nestjs/common';
import { addMonths, today } from '../src/common/util';
import { makeBlankPdf, makeStatementPdf } from './fixtures/make-pdf';
import { addMember, api, bootApp, register, setupFamily } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex');

describe('Suporte ao app: importação de PDF, recorrências, sync e anexos', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await bootApp()));
  afterAll(() => app.close());

  const cardPdf = (y: string) =>
    makeStatementPdf(
      [`05/10|IFOOD *RESTAURANTE|R$ 58,90`, `07/10|UBER TRIP|23,45`, `12/10|LOJA XYZ PARC 03/10||150,00`, `15/10|PAGAMENTO RECEBIDO||-1.200,00`, `18/10|ESTORNO AMAZON||-39,90`, `20/10|Total da fatura||1.234,56`],
      { header: ['Fatura Cartão Exemplo', `Vencimento: 10/11/${y}`] },
    );

  it('importa fatura em PDF: extrai, sugere categoria, exige confirmação e detecta duplicatas na reimportação', async () => {
    const s = await register(app, 'Imp');
    const f = await setupFamily(app, s);
    const pdf = await cardPdf(today().slice(0, 4));

    const r = await api(app, s).post(`/families/${f.familyId}/imports`).field('sourceType', 'CARD_STATEMENT').field('targetCardId', f.cardId).attach('file', pdf, 'fatura.pdf').expect(201);
    expect(r.body.status).toBe('REVIEW');
    expect(r.body.items.map((i: { description: string }) => i.description)).toEqual(['IFOOD *RESTAURANTE', 'UBER TRIP', 'LOJA XYZ PARC 03/10', 'ESTORNO AMAZON']);
    const byDesc = Object.fromEntries(r.body.items.map((i: { description: string }) => [i.description, i]));
    expect(byDesc['ESTORNO AMAZON'].type).toBe('INCOME');
    expect(byDesc['LOJA XYZ PARC 03/10'].installmentHint).toBe('03/10');
    expect(byDesc['IFOOD *RESTAURANTE'].categoryId).toBe(f.cat('Delivery'));
    expect(byDesc['UBER TRIP'].categoryId).toBe(f.cat('Aplicativos'));

    // Nada foi lançado ainda
    expect((await api(app, s).get(`/families/${f.familyId}/transactions?source=PDF_IMPORT`).expect(200)).body.data).toHaveLength(0);

    // Item sem categoria marcado bloqueia a confirmação
    const noCat = await api(app, s).post(`/families/${f.familyId}/imports/${r.body.id}/confirm`).send({}).expect(400);
    expect(noCat.body.code).toBe('VALIDATION_ERROR');

    const edits = [
      { itemId: byDesc['LOJA XYZ PARC 03/10'].id, categoryId: f.cat('Vestuário'), description: 'Loja XYZ' },
      { itemId: byDesc['ESTORNO AMAZON'].id, decision: 'SKIP' },
    ];
    const ok = await api(app, s).post(`/families/${f.familyId}/imports/${r.body.id}/confirm`).send({ items: edits }).expect(200);
    expect(ok.body).toMatchObject({ status: 'CONFIRMED', created: 3, skipped: 1 });
    const imported = (await api(app, s).get(`/families/${f.familyId}/transactions?source=PDF_IMPORT&from=2000-01-01&to=2100-01-01`).expect(200)).body.data;
    expect(imported).toHaveLength(3);
    expect(imported.every((t: { card: { id: string } | null }) => t.card?.id === f.cardId)).toBe(true);

    // Confirmar de novo não é permitido
    await api(app, s).post(`/families/${f.familyId}/imports/${r.body.id}/confirm`).send({}).expect(422);

    // Reimportar o mesmo extrato: tudo que foi lançado vira provável duplicata, desmarcado
    const again = await api(app, s).post(`/families/${f.familyId}/imports`).field('sourceType', 'CARD_STATEMENT').field('targetCardId', f.cardId).attach('file', pdf, 'fatura.pdf').expect(201);
    const dupItems = again.body.items.filter((i: { duplicate: { level: string } | null }) => i.duplicate?.level === 'PROBABLE');
    expect(dupItems.length).toBeGreaterThanOrEqual(2);
    expect(dupItems.every((i: { decision: string }) => i.decision === 'SKIP')).toBe(true);
    expect(again.body.stats.alreadyImportedAt).toBeTruthy();
    // A categoria escolhida na revisão foi aprendida
    const loja = again.body.items.find((i: { description: string }) => i.description.startsWith('LOJA XYZ'));
    expect(loja.categoryId).toBe(f.cat('Vestuário'));
    await api(app, s).post(`/families/${f.familyId}/imports/${again.body.id}/cancel`).expect(204);
  });

  it('extrato de conta corrente, PDF sem texto e arquivo que não é PDF', async () => {
    const s = await register(app, 'Imp');
    const f = await setupFamily(app, s);
    const chk = await makeStatementPdf(['01/10/2026|SALDO ANTERIOR||5.000,00', '02/10/2026|PIX RECEBIDO JOAO|300,00|5.300,00', '03/10/2026|PAGAMENTO BOLETO ENEL|-210,55|5.089,45'], { header: ['Extrato conta corrente'] });
    const r = await api(app, s).post(`/families/${f.familyId}/imports`).field('sourceType', 'CHECKING').field('targetAccountId', f.accountId).attach('file', chk, 'extrato.pdf').expect(201);
    expect(r.body.items.map((i: { type: string; amount: string }) => `${i.type}:${i.amount}`)).toEqual(['INCOME:300.00', 'EXPENSE:210.55']);

    const blank = await api(app, s).post(`/families/${f.familyId}/imports`).field('sourceType', 'CHECKING').field('targetAccountId', f.accountId).attach('file', await makeBlankPdf(), 'scan.pdf').expect(201);
    expect(blank.body.status).toBe('FAILED');
    expect(blank.body.failureReason).toMatch(/manualmente/);

    const notPdf = await api(app, s).post(`/families/${f.familyId}/imports`).field('sourceType', 'CHECKING').field('targetAccountId', f.accountId).attach('file', PNG, 'foto.pdf').expect(422);
    expect(notPdf.body.code).toBe('UNSUPPORTED_FILE');
    // Meio incompatível com o tipo de extrato
    await api(app, s).post(`/families/${f.familyId}/imports`).field('sourceType', 'CARD_STATEMENT').field('targetAccountId', f.accountId).attach('file', chk, 'x.pdf').expect(400);
  });

  it('recorrência mensal gera as ocorrências até hoje, sem duplicar ao rodar de novo', async () => {
    const s = await register(app, 'Rec');
    const f = await setupFamily(app, s);
    const start = addMonths(today(), -2);
    const r = await api(app, s).post(`/families/${f.familyId}/recurrences`).send({ type: 'EXPENSE', amount: '129.90', description: 'Internet fibra', categoryId: f.cat('Internet e telefone'), accountId: f.accountId, frequency: 'MONTHLY', startDate: start }).expect(201);
    expect(r.body.generatedNow).toBe(3);
    expect(r.body.nextRunDate).toBe(addMonths(start, 3));
    const run = await api(app, s).post(`/families/${f.familyId}/recurrences/run`).expect(200);
    expect(run.body.created).toBe(0);
    const list = (await api(app, s).get(`/families/${f.familyId}/transactions?source=RECURRENCE&from=2000-01-01&to=2100-01-01`).expect(200)).body.data;
    expect(list).toHaveLength(3);

    // Ocorrência excluída não volta; encerrar a regra mantém as já geradas
    await api(app, s).delete(`/families/${f.familyId}/transactions/${list[0].id}`).expect(200);
    expect((await api(app, s).post(`/families/${f.familyId}/recurrences/run`).expect(200)).body.created).toBe(0);
    await api(app, s).delete(`/families/${f.familyId}/recurrences/${r.body.id}`).expect(204);
    expect((await api(app, s).get(`/families/${f.familyId}/recurrences/${r.body.id}`).expect(200)).body.isActive).toBe(false);

    const bad = await api(app, s).post(`/families/${f.familyId}/recurrences`).send({ type: 'EXPENSE', amount: '10.00', description: 'x', categoryId: f.cat('Salário'), accountId: f.accountId, frequency: 'MONTHLY', startDate: start }).expect(422);
    expect(bad.body.code).toBe('CATEGORY_KIND_MISMATCH');
  });

  it('sync incremental devolve só o que mudou, com exclusões, respeitando a visibilidade', async () => {
    const owner = await register(app, 'Sync');
    const f = await setupFamily(app, owner);
    const member = await addMember(app, owner, f.familyId, 'MEMBER', 'Membro');
    const priv = (await api(app, owner).post(`/families/${f.familyId}/accounts`).send({ type: 'CHECKING', name: 'Privada', openingBalance: '0.00', openingDate: '2026-01-01', visibility: 'RESTRICTED' }).expect(201)).body;
    const t1 = (await api(app, owner).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '10.00', description: 'Pão', categoryId: f.cat('Mercado'), accountId: f.accountId, occurredOn: today() }).expect(201)).body;
    await api(app, owner).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '99.00', description: 'Segredo', categoryId: f.cat('Lazer'), accountId: priv.id, occurredOn: today() }).expect(201);

    const full = (await api(app, member).get(`/families/${f.familyId}/sync/changes`).expect(200)).body;
    expect(full.transactions.map((t: { description: string }) => t.description)).toEqual(['Pão']);
    expect(full.accounts.map((a: { name: string }) => a.name)).not.toContain('Privada');
    expect(full.categories.length).toBeGreaterThan(10);
    expect(full.members).toHaveLength(2);

    await new Promise((r) => setTimeout(r, 1100));
    const next = (await api(app, member).get(`/families/${f.familyId}/sync/changes?since=${encodeURIComponent(full.cursor)}`).expect(200)).body;
    // Sem mudanças além da janela de sobreposição de 1 s
    expect(next.transactions.length).toBeLessThanOrEqual(1);

    await new Promise((r) => setTimeout(r, 1100));
    const cursor2 = next.cursor;
    await api(app, owner).delete(`/families/${f.familyId}/transactions/${t1.id}`).expect(200);
    const after = (await api(app, member).get(`/families/${f.familyId}/sync/changes?since=${encodeURIComponent(cursor2)}`).expect(200)).body;
    expect(after.transactions).toEqual([expect.objectContaining({ id: t1.id, deleted: true })]);
  });

  it('anexa foto de nota fiscal ao lançamento e baixa pela API', async () => {
    const s = await register(app, 'Anexo');
    const f = await setupFamily(app, s);
    const t = (await api(app, s).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '42.00', description: 'Padaria', categoryId: f.cat('Mercado'), accountId: f.accountId, occurredOn: today(), source: 'RECEIPT_OCR' }).expect(201)).body;
    const up = await api(app, s).post(`/families/${f.familyId}/transactions/${t.id}/attachments`).attach('file', PNG, 'nota.png').expect(201);
    expect(up.body.mimeType).toBe('image/png');
    const list = (await api(app, s).get(`/families/${f.familyId}/transactions/${t.id}/attachments`).expect(200)).body;
    expect(list).toHaveLength(1);
    const dl = await api(app, s).get(`/families/${f.familyId}/files/${up.body.id}/content`).expect(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
    const bad = await api(app, s).post(`/families/${f.familyId}/transactions/${t.id}/attachments`).attach('file', Buffer.from('%PDF-1.4 falso arquivo'), 'nota.jpg').expect(422);
    expect(bad.body.code).toBe('UNSUPPORTED_FILE');
    // Outra família não acessa o arquivo
    const other = await register(app, 'Outro');
    await api(app, other).get(`/families/${f.familyId}/files/${up.body.id}/content`).expect(404);
    await api(app, s).delete(`/families/${f.familyId}/transactions/${t.id}/attachments/${up.body.id}`).expect(204);
  });
});
