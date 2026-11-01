import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

export async function bootApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

let n = 0;
export const uniq = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

export interface Session {
  token: string;
  refreshToken: string;
  userId: string;
  email: string;
}

export async function register(app: INestApplication, name = 'Teste'): Promise<Session> {
  const email = `${uniq(name.toLowerCase())}@teste.com`;
  const r = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ name, email, password: 'Senha@1234' }).expect(201);
  return { token: r.body.accessToken, refreshToken: r.body.refreshToken, userId: r.body.user.id, email };
}

export function api(app: INestApplication, s?: Session) {
  const agent = request(app.getHttpServer());
  const auth = (r: request.Test) => (s ? r.set('Authorization', `Bearer ${s.token}`) : r);
  return {
    get: (u: string) => auth(agent.get(`/api/v1${u}`)),
    post: (u: string) => auth(agent.post(`/api/v1${u}`)),
    patch: (u: string) => auth(agent.patch(`/api/v1${u}`)),
    put: (u: string) => auth(agent.put(`/api/v1${u}`)),
    delete: (u: string) => auth(agent.delete(`/api/v1${u}`)),
  };
}

/** Família com conta, cartão (fecha dia 3, vence dia 10) e mapa de categorias. */
export async function setupFamily(app: INestApplication, s: Session) {
  const fam = (await api(app, s).post('/families').send({ name: 'Família Teste' }).expect(201)).body;
  const cats = (await api(app, s).get(`/families/${fam.id}/categories`).expect(200)).body as { id: string; name: string }[];
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const account = (await api(app, s).post(`/families/${fam.id}/accounts`).send({ type: 'CHECKING', name: 'Conta', openingBalance: '1000.00', openingDate: '2026-01-01' }).expect(201)).body;
  const card = (await api(app, s).post(`/families/${fam.id}/cards`).send({ name: 'Cartão', creditLimit: '5000.00', closingDay: 3, dueDay: 10 }).expect(201)).body;
  return { familyId: fam.id as string, cat, accountId: account.id as string, cardId: card.id as string };
}

/** Convida e aceita, devolvendo a sessão do novo membro. */
export async function addMember(app: INestApplication, owner: Session, familyId: string, role: 'ADMIN' | 'MEMBER' | 'VIEWER', name = 'Membro') {
  const s = await register(app, name);
  const inv = (await api(app, owner).post(`/families/${familyId}/invitations`).send({ email: s.email, role }).expect(201)).body;
  await api(app, s).post('/invitations/accept').send({ token: inv.devInviteToken }).expect(200);
  return s;
}
