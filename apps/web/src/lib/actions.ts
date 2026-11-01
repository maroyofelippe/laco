import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError } from './api';

/**
 * Executa a operação e volta para a página com ?ok= ou ?err= (mensagem exibida em banner).
 * redirect() lança internamente, por isso fica fora do try.
 */
export async function runAction(back: string, okMessage: string | (() => string), fn: () => Promise<unknown>) {
  let target: string;
  try {
    await fn();
    target = withParam(back, 'ok', typeof okMessage === 'function' ? okMessage() : okMessage);
  } catch (e) {
    if (e instanceof ApiError) target = withParam(back, 'err', e.userMessage);
    else throw e;
  }
  redirect(target);
}

function withParam(url: string, k: string, v: string) {
  const [path, query = ''] = url.split('?');
  const p = new URLSearchParams(query);
  p.delete('ok');
  p.delete('err');
  p.set(k, v);
  return `${path}?${p.toString()}`;
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};

/** "1.234,56" ou "1234.56" → "1234.56" */
export const moneyField = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return undefined;
  const normalized = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
  return Number.isFinite(Number(normalized)) ? Number(normalized).toFixed(2) : v;
};
