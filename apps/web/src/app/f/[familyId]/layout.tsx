import Link from 'next/link';
import { LacoLogo, LacoSymbol } from '@/components/Logo';
import { Nav } from '@/components/Nav';
import { api } from '@/lib/api';
import { getFamily } from '@/lib/family';
import { isAdmin, ROLE_LABEL } from '@/lib/format';
import { getSession } from '@/lib/server-session';
import type { AlertPage } from '@/lib/types';
import { logoutAction } from '../../login/actions';

export default async function FamilyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  const [family, session, alerts] = await Promise.all([
    getFamily(familyId),
    getSession(),
    api<AlertPage>(`/families/${familyId}/alerts`, { query: { status: 'ACTIVE', limit: 1 } }),
  ]);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-borda bg-superficie p-4 md:flex">
        <div className="mb-5 px-2"><LacoLogo size={30} /></div>
        <Link href="/familias" className="mb-5 block rounded-md border border-borda bg-fundo px-3 py-2 transition hover:border-verde" title="Trocar de família">
          <span className="block truncate text-sm font-bold text-tinta">{family.name}</span>
          <span className="block text-xs text-apoio">{ROLE_LABEL[family.myRole]} · trocar</span>
        </Link>
        <Nav familyId={familyId} isAdmin={isAdmin(family.myRole)} unread={alerts.unreadCount} />
        <div className="mt-auto border-t border-borda pt-4">
          <div className="px-2 text-sm font-semibold text-tinta">{session?.user.name}</div>
          <div className="truncate px-2 text-xs text-apoio">{session?.user.email}</div>
          <form action={logoutAction} className="mt-2 px-2">
            <button className="text-xs font-semibold text-apoio hover:text-despesa">Sair</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-borda bg-superficie px-4 py-3 md:hidden">
          <Link href="/familias" className="flex items-center gap-2 font-bold text-verde"><LacoSymbol size={26} />{family.name}</Link>
          <form action={logoutAction}><button className="text-sm text-apoio">Sair</button></form>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
