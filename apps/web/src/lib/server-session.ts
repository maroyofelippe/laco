import 'server-only';
import { cookies } from 'next/headers';
import { COOKIE, cookieOptions, sealSession, unsealSession, type Session } from './session';

export async function getSession(): Promise<Session | null> {
  return unsealSession((await cookies()).get(COOKIE)?.value);
}

/** Só pode ser chamado em Server Actions / Route Handlers. */
export async function saveSession(s: Session) {
  (await cookies()).set(COOKIE, await sealSession(s), cookieOptions);
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
