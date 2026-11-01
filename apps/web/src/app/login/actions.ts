'use server';
import { redirect } from 'next/navigation';
import { ApiError, publicApi } from '@/lib/api';
import { str } from '@/lib/actions';
import { clearSession, getSession, saveSession } from '@/lib/server-session';
import { apiUrl } from '@/lib/session';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  user: { id: string; name: string; email: string };
  families: { id: string }[];
}

export async function loginAction(formData: FormData) {
  const email = str(formData, 'email') ?? '';
  const password = String(formData.get('password') ?? '');
  const next = str(formData, 'next');
  let target: string;
  try {
    const r = await publicApi<LoginResponse>('/auth/login', { email, password, client: 'WEB' });
    await saveSession({ at: r.accessToken, rt: r.refreshToken, exp: Date.now() + r.accessTokenExpiresIn * 1000, last: Date.now(), user: r.user });
    // Só aceita caminhos internos (evita open redirect)
    target = next && next.startsWith('/') && !next.startsWith('//') ? next : r.families.length === 1 ? `/f/${r.families[0].id}/dashboard` : '/familias';
  } catch (e) {
    const msg = e instanceof ApiError ? e.detail : 'Não foi possível conectar à API.';
    target = `/login?err=${encodeURIComponent(msg)}&email=${encodeURIComponent(email)}`;
  }
  redirect(target);
}

export async function logoutAction() {
  const s = await getSession();
  if (s) {
    await fetch(`${apiUrl()}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: s.rt }), cache: 'no-store' }).catch(() => null);
  }
  await clearSession();
  redirect('/login');
}
