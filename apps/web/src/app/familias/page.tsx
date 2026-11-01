import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LacoLogo } from '@/components/Logo';
import { Banner } from '@/components/ui';
import { SubmitButton } from '@/components/SubmitButton';
import { api, ApiError } from '@/lib/api';
import { str } from '@/lib/actions';
import { ROLE_LABEL } from '@/lib/format';
import { getSession } from '@/lib/server-session';
import type { MyFamily } from '@/lib/types';
import { logoutAction } from '../login/actions';

async function createFamily(fd: FormData) {
  'use server';
  let target: string;
  try {
    const fam = await api<{ id: string }>('/families', { method: 'POST', body: { name: str(fd, 'name') } });
    target = `/f/${fam.id}/dashboard`;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    target = `/familias?err=${encodeURIComponent(e.userMessage)}`;
  }
  redirect(target);
}

export default async function FamiliesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const families = await api<MyFamily[]>('/me/families');
  return (
    <main className="mx-auto max-w-xl p-6 pt-16">
      <div className="mb-8"><LacoLogo size={36} /></div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-verde">Olá, {session?.user.name}</h1>
          <p className="text-sm text-apoio">Qual família você quer acompanhar hoje?</p>
        </div>
        <form action={logoutAction}><button className="btn-secondary">Sair</button></form>
      </div>
      <Banner ok={sp.ok} err={sp.err} />
      <ul className="space-y-2">
        {families.map((f) => (
          <li key={f.id}>
            <Link href={`/f/${f.id}/dashboard`} className="flex items-center justify-between rounded-lg border border-borda bg-superficie p-4 transition hover:border-verde">
              <span className="font-semibold text-tinta">{f.name}</span>
              <span className="text-xs text-apoio">{ROLE_LABEL[f.role]}</span>
            </Link>
          </li>
        ))}
        {!families.length && <li className="rounded-lg border border-dashed border-borda p-6 text-center text-sm text-apoio">Você ainda não faz parte de uma família por aqui. Crie a sua abaixo ou aceite um convite pelo app.</li>}
      </ul>
      <form action={createFamily} className="mt-6 flex gap-2">
        <input className="input" name="name" placeholder="Nome da família, ex.: Família Silva" required minLength={2} maxLength={120} />
        <SubmitButton>Criar família</SubmitButton>
      </form>
    </main>
  );
}
