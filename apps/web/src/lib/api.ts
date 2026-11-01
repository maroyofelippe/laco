import 'server-only';
import { redirect } from 'next/navigation';
import { getSession } from './server-session';
import { apiUrl } from './session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail: string, public errors?: { field: string; message: string }[]) {
    super(detail);
  }
  /** Mensagem amigável incluindo erros por campo. */
  get userMessage() {
    if (this.errors?.length) return `${this.detail}: ${this.errors.map((e) => `${e.field} ${e.message}`).join('; ')}`;
    return this.detail;
  }
}

type Query = Record<string, string | number | undefined | null>;

export function qs(q?: Query) {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Chamada servidor → API com o token da sessão. O token é renovado de forma proativa
 * no middleware; aqui um 401 significa sessão inválida e volta para o login.
 */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; query?: Query; headers?: Record<string, string> } = {}): Promise<T> {
  const session = await getSession();
  if (!session) redirect('/login');
  const res = await fetch(`${apiUrl()}${path}${qs(init.query)}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session.at}`,
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login?expired=1');
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'ERROR', data.detail ?? 'Erro ao chamar a API', data.errors);
  return data as T;
}

/** Chamada sem autenticação (login). */
export async function publicApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'ERROR', data.detail ?? 'Erro ao chamar a API', data.errors);
  return data as T;
}
