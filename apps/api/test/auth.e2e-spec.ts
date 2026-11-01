import type { INestApplication } from '@nestjs/common';
import { api, bootApp, register } from './helpers';

describe('Autenticação', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await bootApp()));
  afterAll(() => app.close());

  it('registra, entra e consulta /me', async () => {
    const s = await register(app, 'Auth');
    const me = await api(app, s).get('/me').expect(200);
    expect(me.body.email).toBe(s.email);
    const login = await api(app).post('/auth/login').send({ email: s.email, password: 'Senha@1234' }).expect(200);
    expect(login.body.accessToken).toBeDefined();
    expect(login.body.accessTokenExpiresIn).toBe(900);
  });

  it('recusa senha errada sem revelar se o e-mail existe', async () => {
    const s = await register(app, 'Auth');
    const a = await api(app).post('/auth/login').send({ email: s.email, password: 'errada123' }).expect(401);
    const b = await api(app).post('/auth/login').send({ email: 'naoexiste@teste.com', password: 'errada123' }).expect(401);
    expect(a.body.code).toBe('INVALID_CREDENTIALS');
    expect(b.body.code).toBe('INVALID_CREDENTIALS');
    expect(a.headers['content-type']).toContain('application/problem+json');
  });

  it('exige token nas rotas protegidas', async () => {
    const r = await api(app).get('/me').expect(401);
    expect(r.body.code).toBe('UNAUTHORIZED');
    await api(app).get('/me').set('Authorization', 'Bearer xxx').expect(401);
  });

  it('rotaciona o refresh token e revoga a cadeia ao detectar reuso', async () => {
    const s = await register(app, 'Auth');
    const r1 = await api(app).post('/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    // reutiliza o token antigo: reuso detectado
    const reuse = await api(app).post('/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    expect(reuse.body.code).toBe('REFRESH_REUSED');
    // o token novo também foi revogado junto com a cadeia
    await api(app).post('/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
  });

  it('valida o corpo com erros por campo', async () => {
    const r = await api(app).post('/auth/register').send({ name: 'X', email: 'invalido', password: '123', extra: 1 }).expect(400);
    expect(r.body.code).toBe('VALIDATION_ERROR');
    const fields = r.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'email', 'password', 'extra']));
  });
});
