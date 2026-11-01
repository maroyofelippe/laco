import type { INestApplication } from '@nestjs/common';
import { today } from '../src/common/util';
import { addMember, api, bootApp, register, setupFamily } from './helpers';

describe('Limites e alertas', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await bootApp()));
  afterAll(() => app.close());

  it('emite um alerta por faixa, sem duplicar, entrega por cursor e resolve com histerese', async () => {
    const owner = await register(app, 'Dona');
    const f = await setupFamily(app, owner);
    const member = await addMember(app, owner, f.familyId, 'MEMBER', 'Membro');
    const d = today();
    const limit = (await api(app, owner).post(`/families/${f.familyId}/limits`).send({ name: 'Lazer', scopeType: 'CATEGORY', scopeId: f.cat('Lazer'), period: 'MONTHLY', amount: '100.00', thresholds: [80, 100] }).expect(201)).body;
    expect(limit).toMatchObject({ consumed: '0.00', status: 'OK' });

    const spend = (amount: string) =>
      api(app, member).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount, description: 'Cinema', categoryId: f.cat('Lazer'), accountId: f.accountId, occurredOn: d }).expect(201);

    const r1 = (await spend('50.00')).body;
    expect(r1.alertsTriggered).toHaveLength(0);
    const r2 = (await spend('35.00')).body; // 85%
    expect(r2.alertsTriggered).toEqual([expect.objectContaining({ level: 'WARNING', thresholdPct: 80 })]);
    const r3 = (await spend('1.00')).body; // 86%: mesma faixa, sem novo alerta
    expect(r3.alertsTriggered).toHaveLength(0);

    const feed1 = (await api(app, member).get(`/families/${f.familyId}/alerts?since=0`).expect(200)).body;
    expect(feed1.data).toHaveLength(1);
    expect(feed1.unreadCount).toBe(1);

    const r4 = (await spend('20.00')).body; // 106%
    expect(r4.alertsTriggered).toEqual([expect.objectContaining({ level: 'EXCEEDED', thresholdPct: 100 })]);
    const feed2 = (await api(app, member).get(`/families/${f.familyId}/alerts?since=${feed1.cursor}`).expect(200)).body;
    expect(feed2.data.map((a: { level: string }) => a.level)).toEqual(['EXCEEDED']);

    await api(app, member).post(`/families/${f.familyId}/alerts/${feed1.data[0].id}/read`).expect(204);
    const feed3 = (await api(app, member).get(`/families/${f.familyId}/alerts?status=ACTIVE`).expect(200)).body;
    expect(feed3.unreadCount).toBe(1);

    // remover o gasto de 20 (fica 86%): faixa 100 cai abaixo de 95 → resolvido; faixa 80 continua ativa
    await api(app, member).delete(`/families/${f.familyId}/transactions/${r4.id}`).expect(200);
    const all = (await api(app, owner).get(`/families/${f.familyId}/alerts`).expect(200)).body;
    const byTh = Object.fromEntries(all.data.map((a: { thresholdPct: number; status: string }) => [a.thresholdPct, a.status]));
    expect(byTh).toEqual({ 80: 'ACTIVE', 100: 'RESOLVED' });

    const cons = (await api(app, owner).get(`/families/${f.familyId}/limits/${limit.id}/consumption`).expect(200)).body;
    expect(cons).toMatchObject({ consumed: '86.00', consumedPct: 86, status: 'WARNING' });
    expect(cons.topTransactions[0].amount).toBe('50.00');
  });

  it('despesa fora do escopo não afeta o limite; transferência não conta', async () => {
    const owner = await register(app, 'Dona');
    const f = await setupFamily(app, owner);
    await api(app, owner).post(`/families/${f.familyId}/limits`).send({ name: 'Mercado', scopeType: 'CATEGORY', scopeId: f.cat('Mercado'), period: 'MONTHLY', amount: '10.00' }).expect(201);
    const r = (await api(app, owner).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '50.00', description: 'Remédio', categoryId: f.cat('Farmácia'), accountId: f.accountId, occurredOn: today() }).expect(201)).body;
    expect(r.alertsTriggered).toHaveLength(0);
  });

  it('valida escopo do limite', async () => {
    const owner = await register(app, 'Dona');
    const f = await setupFamily(app, owner);
    const r = await api(app, owner).post(`/families/${f.familyId}/limits`).send({ name: 'X', scopeType: 'CATEGORY', period: 'MONTHLY', amount: '10.00' }).expect(400);
    expect(r.body.code).toBe('VALIDATION_ERROR');
    const cycle = await api(app, owner).post(`/families/${f.familyId}/limits`).send({ name: 'X', scopeType: 'FAMILY', period: 'CARD_CYCLE', amount: '10.00' }).expect(400);
    expect(cycle.body.code).toBe('VALIDATION_ERROR');
    const ok = await api(app, owner).post(`/families/${f.familyId}/limits`).send({ name: 'Ciclo', scopeType: 'CARD', scopeId: f.cardId, period: 'CARD_CYCLE', amount: '1000.00' }).expect(201);
    expect(ok.body.currentPeriod).toBeTruthy();
  });
});
