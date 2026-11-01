import type { INestApplication } from '@nestjs/common';
import { addMember, api, bootApp, register, setupFamily } from './helpers';

describe('Isolamento entre famílias e permissões', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await bootApp()));
  afterAll(() => app.close());

  it('usuário de outra família recebe 404 em todas as rotas da família', async () => {
    const a = await register(app, 'Alice');
    const b = await register(app, 'Bruno');
    const fa = await setupFamily(app, a);
    const tx = (await api(app, a).post(`/families/${fa.familyId}/transactions`).send({ type: 'EXPENSE', amount: '10.00', description: 'x', categoryId: fa.cat('Mercado'), accountId: fa.accountId, occurredOn: '2026-10-10' }).expect(201)).body;

    const routes = [
      `/families/${fa.familyId}`, `/families/${fa.familyId}/members`, `/families/${fa.familyId}/categories`, `/families/${fa.familyId}/accounts`,
      `/families/${fa.familyId}/accounts/${fa.accountId}`, `/families/${fa.familyId}/cards`, `/families/${fa.familyId}/transactions`,
      `/families/${fa.familyId}/transactions/${tx.id}`, `/families/${fa.familyId}/limits`, `/families/${fa.familyId}/alerts`,
      `/families/${fa.familyId}/budgets`, `/families/${fa.familyId}/dashboard/summary`, `/families/${fa.familyId}/dashboard/by-category`,
      `/families/${fa.familyId}/dashboard/timeseries`, `/families/${fa.familyId}/audit-logs`,
    ];
    for (const r of routes) {
      const res = await api(app, b).get(r);
      expect([r, res.status]).toEqual([r, 404]);
    }
    await api(app, b).post(`/families/${fa.familyId}/transactions`).send({ type: 'EXPENSE', amount: '1.00', description: 'x', categoryId: fa.cat('Mercado'), accountId: fa.accountId, occurredOn: '2026-10-10' }).expect(404);
  });

  it('não permite referenciar categoria/conta de outra família na própria família', async () => {
    const a = await register(app, 'Alice');
    const b = await register(app, 'Bruno');
    const fa = await setupFamily(app, a);
    const fb = await setupFamily(app, b);
    const catRes = await api(app, b).post(`/families/${fb.familyId}/transactions`).send({ type: 'EXPENSE', amount: '1.00', description: 'x', categoryId: fa.cat('Mercado'), accountId: fb.accountId, occurredOn: '2026-10-10' }).expect(422);
    expect(catRes.body.code).toBe('INVALID_REFERENCE');
    await api(app, b).post(`/families/${fb.familyId}/transactions`).send({ type: 'EXPENSE', amount: '1.00', description: 'x', categoryId: fb.cat('Mercado'), accountId: fa.accountId, occurredOn: '2026-10-10' }).expect(404);
    // listagem da família B não traz nada da família A
    const list = await api(app, b).get(`/families/${fb.familyId}/transactions`).expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('VIEWER só lê; MEMBER só edita os próprios lançamentos', async () => {
    const owner = await register(app, 'Dona');
    const f = await setupFamily(app, owner);
    const viewer = await addMember(app, owner, f.familyId, 'VIEWER', 'Viewer');
    const member = await addMember(app, owner, f.familyId, 'MEMBER', 'Membro');

    await api(app, viewer).get(`/families/${f.familyId}/transactions`).expect(200);
    const denied = await api(app, viewer).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '5.00', description: 'x', categoryId: f.cat('Mercado'), accountId: f.accountId, occurredOn: '2026-10-10' }).expect(403);
    expect(denied.body.code).toBe('FAMILY_PERMISSION_DENIED');

    const ownerTx = (await api(app, owner).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '5.00', description: 'Do titular', categoryId: f.cat('Mercado'), accountId: f.accountId, occurredOn: '2026-10-10' }).expect(201)).body;
    await api(app, member).patch(`/families/${f.familyId}/transactions/${ownerTx.id}`).set('If-Match', '1').send({ description: 'hack' }).expect(403);
    const mine = (await api(app, member).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '7.00', description: 'Meu', categoryId: f.cat('Mercado'), accountId: f.accountId, occurredOn: '2026-10-10' }).expect(201)).body;
    await api(app, member).patch(`/families/${f.familyId}/transactions/${mine.id}`).set('If-Match', '1').send({ description: 'Meu editado' }).expect(200);

    // MEMBER não administra
    await api(app, member).post(`/families/${f.familyId}/categories`).send({ name: 'Nova', kind: 'EXPENSE' }).expect(403);
    await api(app, member).post(`/families/${f.familyId}/limits`).send({ name: 'L', scopeType: 'FAMILY', period: 'MONTHLY', amount: '10.00' }).expect(403);
  });

  it('conta RESTRICTED não aparece para MEMBER sem permissão, e aparece após permissão', async () => {
    const owner = await register(app, 'Dona');
    const f = await setupFamily(app, owner);
    const member = await addMember(app, owner, f.familyId, 'MEMBER', 'Membro');
    const priv = (await api(app, owner).post(`/families/${f.familyId}/accounts`).send({ type: 'CHECKING', name: 'Privada', openingBalance: '500.00', openingDate: '2026-01-01', visibility: 'RESTRICTED' }).expect(201)).body;
    await api(app, owner).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '99.00', description: 'Segredo', categoryId: f.cat('Lazer'), accountId: priv.id, occurredOn: '2026-10-10' }).expect(201);

    const accs = (await api(app, member).get(`/families/${f.familyId}/accounts`).expect(200)).body;
    expect(accs.map((a: { id: string }) => a.id)).not.toContain(priv.id);
    await api(app, member).get(`/families/${f.familyId}/accounts/${priv.id}`).expect(404);
    const list = (await api(app, member).get(`/families/${f.familyId}/transactions?q=segredo`).expect(200)).body;
    expect(list.data).toHaveLength(0);
    const dash = (await api(app, member).get(`/families/${f.familyId}/dashboard/summary?from=2026-10-01&to=2026-10-31`).expect(200)).body;
    expect(dash.expense).toBe('0.00');

    await api(app, owner).put(`/families/${f.familyId}/members/${member.userId}/permissions`).send({ items: [{ resourceType: 'ACCOUNT', resourceId: priv.id, access: 'VIEW' }] }).expect(200);
    const after = (await api(app, member).get(`/families/${f.familyId}/transactions?q=segredo`).expect(200)).body;
    expect(after.data).toHaveLength(1);
    // VIEW não permite lançar
    await api(app, member).post(`/families/${f.familyId}/transactions`).send({ type: 'EXPENSE', amount: '1.00', description: 'x', categoryId: f.cat('Lazer'), accountId: priv.id, occurredOn: '2026-10-10' }).expect(403);
  });

  it('convite só pode ser aceito pelo e-mail convidado; família nunca fica sem OWNER', async () => {
    const owner = await register(app, 'Dona');
    const intruso = await register(app, 'Intruso');
    const f = await setupFamily(app, owner);
    const inv = (await api(app, owner).post(`/families/${f.familyId}/invitations`).send({ email: 'outra.pessoa@teste.com', role: 'MEMBER' }).expect(201)).body;
    const r = await api(app, intruso).post('/invitations/accept').send({ token: inv.devInviteToken }).expect(403);
    expect(r.body.code).toBe('INVITATION_EMAIL_MISMATCH');
    const last = await api(app, owner).patch(`/families/${f.familyId}/members/${owner.userId}`).send({ role: 'ADMIN' }).expect(422);
    expect(last.body.code).toBe('LAST_OWNER');
  });
});
