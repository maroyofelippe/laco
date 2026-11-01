/**
 * Sessão do painel: tokens da API ficam CRIPTOGRAFADOS (iron-session/sealData) num cookie
 * httpOnly + SameSite=Strict. O JavaScript do navegador nunca lê o JWT.
 * Este arquivo roda tanto no middleware (Edge) quanto no servidor Node.
 */
import { sealData, unsealData } from 'iron-session';

export const COOKIE = 'laco_session';
const MAX_AGE = 60 * 60 * 24 * 30; // limitado também pelo refresh token da API

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface Session {
  at: string; // access token (JWT, 15 min)
  rt: string; // refresh token (opaco, rotativo)
  exp: number; // expiração do access token (epoch ms)
  last: number; // última atividade (epoch ms) para timeout por inatividade
  user: SessionUser;
}

function password() {
  const p = process.env.SESSION_SECRET;
  if (!p || p.length < 32) throw new Error('SESSION_SECRET ausente ou com menos de 32 caracteres');
  return p;
}

export const sealSession = (s: Session) => sealData(s, { password: password(), ttl: MAX_AGE });

export async function unsealSession(value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  try {
    const s = await unsealData<Session>(value, { password: password(), ttl: MAX_AGE });
    return s && s.at ? s : null;
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: MAX_AGE,
};

export const idleMs = () => Number(process.env.SESSION_IDLE_MINUTES ?? 30) * 60_000;
export const apiUrl = () => process.env.API_URL ?? 'http://localhost:3001/api/v1';
