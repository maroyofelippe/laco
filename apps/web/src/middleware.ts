import { NextResponse, type NextRequest } from 'next/server';
import { apiUrl, COOKIE, cookieOptions, idleMs, sealSession, unsealSession, type Session } from './lib/session';

const PUBLIC = ['/login'];
const REFRESH_BEFORE_MS = 60_000;

/**
 * Protege o painel:
 * - sem sessão → /login;
 * - inatividade acima de SESSION_IDLE_MINUTES → encerra a sessão;
 * - access token perto de expirar → renova com o refresh token (rotação) ANTES da página renderizar,
 *   gravando o cookie novo na resposta e na própria requisição em andamento.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  const session = await unsealSession(req.cookies.get(COOKIE)?.value);

  if (!session) {
    if (isPublic) return NextResponse.next();
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }

  const now = Date.now();
  if (now - session.last > idleMs()) return logout(req, 'expired');

  let next: Session = { ...session, last: now };
  if (session.exp - now < REFRESH_BEFORE_MS) {
    const res = await fetch(`${apiUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.rt }),
      cache: 'no-store',
    }).catch(() => null);
    if (!res || !res.ok) return logout(req, 'expired');
    const data = (await res.json()) as { accessToken: string; refreshToken: string; accessTokenExpiresIn: number };
    next = { ...next, at: data.accessToken, rt: data.refreshToken, exp: now + data.accessTokenExpiresIn * 1000 };
  }

  if (isPublic) return NextResponse.redirect(new URL('/familias', req.url));

  const sealed = await sealSession(next);
  req.cookies.set(COOKIE, sealed); // a renderização desta requisição já usa o token novo
  const response = NextResponse.next({ request: { headers: req.headers } });
  response.cookies.set(COOKIE, sealed, cookieOptions);
  return response;
}

function logout(req: NextRequest, reason: string) {
  const url = new URL('/login', req.url);
  url.searchParams.set(reason, '1');
  const res = NextResponse.redirect(url);
  res.cookies.delete(COOKIE);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico)$).*)'],
};
