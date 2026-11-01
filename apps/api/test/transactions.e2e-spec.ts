import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { api, bootApp, register, setupFamily, type Session } from './helpers';

describe('Lançamentos', () => {
  let app: INestApplication;
  let s: Session;
  let f: Awaited<ReturnType<typeof setupFamily>>;
  beforeAll(async () => {
    app = await bootApp();
    s = await register(app, 'Tx');
    f = await setupFamily(app, s);
  });
  afterAll(() => app.close());
  const base = () => `/families/${f.familyId}/transactions`;

  it('exige categoria válida, ativa e do mesmo tipo', async () => {
    const noCat = await api(app, s).post(base()).send({ type: 'EXPENSE', amount: '10.00', description: 'x', accountId: f.accountId, occurredOn: '2026-10-10' }).expect(400);
    expect(noCat.body.errors.map((e: { field: string }) => e.field)).toContain('categoryId');
    const kind = await api(app, s).post(base()).send({ type: 'EXPENSE', amount: '10.00', description: 'x', categoryId: f.cat('Salário'), accountId: f.accountId, occurredOn: '2026-10-10' }).expect(422);
    expect(kind.body.code).toBe('CATEGORY_KIND_MISMATCH');
    const c = (await api(app, s).post(`/families/${f.familyId}/categories`).send({ name: 'Temporária', kind: 'EXPENSE' }).expect(201)).body;
    await api(app, s).post(`/families/${f.familyId}/categories/${c.id}/deactivate`).expect(200);
    const inactive = await api(app, s).post(base()).send({ type: 'EXPENSE', amount: '10.00', description: 'x', categoryId: c.id, accountId: f.accountId, occurredOn: '2026-10-10' }).expect(422);
    expect(inactive.body.code).toBe('CATEGORY_INACTIVE');
    const both = await api(app, s).post(base()).send({ type: 'EXPENSE', amount: '10.00', description: 'x', categoryId: f.cat('Mercado'), accountId: f.accountId, cardId: f.cardId, occurredOn: '2026-10-10' }).expect(400);
    expect(both.body.code).toBe('VALIDATION_ERROR');
  });

  it('compra no cartão cai na fatura certa conforme o dia de fechamento', async () => {
    const before = (await api(app, s).post(base()).send({ type: 'EXPENSE', amount: '100.00', description: 'Antes do fechamento', categoryId: f.cat('Mercado'), cardId: f.cardId, occurredOn: '2026-10-02' }).expect(201)).body;
    const onClosing = (await api(app, s).post(base()).send({ type: 'EXPENSE', amount: '50.00', description: 'No dia do fechamento', categoryId: f.cat('Mercado'), cardId: f.cardId, occurredOn: '2026-10-03' }).expect(201)).body;
    expect(before.statement).toMatchObject({ referenceMonth: '2026-10', dueDate: '2026-10-10' });
    expect(onClosing.statement).toMatchObject({ referenceMonth: '2026-11', dueDate: '2026-11-10' });
  });

  it('parcela R$ 100,00 em 3x como 33,34 + 33,33 + 33,33 em faturas consecutivas', async () => {
    const r = (await api(app, s).post(`${base()}/installments`).send({ description: 'Fone', totalAmount: '100.00', installments: 3, firstDate: '2026-10-20', categoryId: f.cat('Outras despesas'), cardId: f.cardId }).expect(201)).body;
    expect(r.transactions.map((t: { amount: string }) => t.amount)).toEqual(['33.34', '33.33', '33.33']);
    expect(r.transactions.map((t: { statement: { referenceMonth: string } }) => t.statement.referenceMonth)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(r.transactions[2].description).toBe('Fone 3/3');
  });

  it('edição exige If-Match e detecta conflito de versão', async () => {
    const t = (await api(app, s).post(base()).send({ type: 'EXPENSE', amount: '20.00', description: 'Padaria', categoryId: f.cat('Mercado'), accountId: f.accountId, occurredOn: '2026-10-11' }).expect(201)).body;
    const missing = await api(app, s).patch(`${base()}/${t.id}`).send({ amount: '21.00' }).expect(400);
    expect(missing.body.code).toBe('PRECONDITION_REQUIRED');
    const ok = (await api(app, s).patch(`${base()}/${t.id}`).set('If-Match', '1').send({ amount: '21.00' }).expect(200)).body;
    expect(ok).toMatchObject({ amount: '21.00', version: 2 });
    const stale = await api(app, s).patch(`${base()}/${t.id}`).set('If-Match', '1').send({ amount: '22.00' }).expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
    await api(app, s).delete(`${base()}/${t.id}`).expect(200);
    await api(app, s).get(`${base()}/${t.id}`).expect(404);
  });

  it('Idempotency-Key evita duplicar lançamento reenviado pelo app', async () => {
    const key = randomUUID();
    const body = { type: 'EXPENSE', amount: '15.00', description: 'Reenvio offline', categoryId: f.cat('Mercado'), accountId: f.accountId, occurredOn: '2026-10-12' };
    const a = await api(app, s).post(base()).set('Idempotency-Key', key).send(body).expect(201);
    const b = await api(app, s).post(base()).set('Idempotency-Key', key).send(body).expect(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
    const list = (await api(app, s).get(`${base()}?q=reenvio`).expect(200)).body;
    expect(list.data).toHaveLength(1);
    const mismatch = await api(app, s).post(base()).set('Idempotency-Key', key).send({ ...body, amount: '16.00' }).expect(409);
    expect(mismatch.body.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('transferência gera duas pernas, não conta como despesa e move o saldo', async () => {
    const poup = (await api(app, s).post(`/families/${f.familyId}/accounts`).send({ type: 'SAVINGS', name: 'Poupança', openingBalance: '0.00', openingDate: '2026-01-01' }).expect(201)).body;
    const r = (await api(app, s).post(`${base()}/transfers`).send({ fromAccountId: f.accountId, toAccountId: poup.id, amount: '200.00', occurredOn: '2026-10-05' }).expect(201)).body;
    expect(r.transactions).toHaveLength(2);
    const bal = (await api(app, s).get(`/families/${f.familyId}/accounts/${poup.id}/balance?at=2026-10-31`).expect(200)).body;
    expect(bal.balance).toBe('200.00');
    const dash = (await api(app, s).get(`/families/${f.familyId}/dashboard/summary?from=2026-10-05&to=2026-10-05`).expect(200)).body;
    expect(dash.expense).toBe('0.00');
  });

  it('paginação por cursor percorre tudo sem repetir e os totais batem com o dashboard', async () => {
    const ids = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: { body: { data: { id: string }[]; nextCursor: string | null; totals: { expense: string } } } = await api(app, s).get(`${base()}?limit=3&from=2026-10-01&to=2026-10-31${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      r.body.data.forEach((t) => ids.add(t.id));
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    const all = (await api(app, s).get(`${base()}?limit=200&from=2026-10-01&to=2026-10-31`).expect(200)).body;
    expect(ids.size).toBe(all.data.length);
    const dash = (await api(app, s).get(`/families/${f.familyId}/dashboard/summary?from=2026-10-01&to=2026-10-31`).expect(200)).body;
    expect(dash.expense).toBe(all.totals.expense);
  });
});
