import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { Badge, Banner, Card, Empty, PageHeader } from '@/components/ui';
import { runAction, str } from '@/lib/actions';
import { api } from '@/lib/api';
import { getFamily } from '@/lib/family';
import { date, dateTime, isAdmin, money } from '@/lib/format';
import type { AlertPage } from '@/lib/types';

async function markRead(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/alertas`, 'Alerta marcado como lido', async () => {
    await api(`/families/${familyId}/alerts/${str(fd, 'id')}/read`, { method: 'POST' });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function dismiss(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/alertas?tab=historico`, 'Alerta dispensado para a família', async () => {
    await api(`/families/${familyId}/alerts/${str(fd, 'id')}/dismiss`, { method: 'POST' });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

export default async function AlertsPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const history = sp.tab === 'historico';
  const [family, page] = await Promise.all([getFamily(familyId), api<AlertPage>(`/families/${familyId}/alerts`, { query: history ? { limit: 200 } : { status: 'ACTIVE' } })]);
  const tab = (active: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-superficie text-tinta' : 'text-apoio hover:text-tinta'}`;

  return (
    <>
      <PageHeader title="Alertas" subtitle={`${page.unreadCount ? `${page.unreadCount} para ler.` : 'Tudo lido.'} Os mesmos avisos chegam ao app de cada pessoa da família.`} />
      <Banner ok={sp.ok} err={sp.err} />
      <div className="mb-4 inline-flex rounded-lg bg-areia p-1">
        <Link href={`/f/${familyId}/alertas`} className={tab(!history)}>Ativos</Link>
        <Link href={`/f/${familyId}/alertas?tab=historico`} className={tab(history)}>Histórico</Link>
      </div>
      <Card>
        {page.data.length ? (
          <ul className="divide-y divide-areia">
            {page.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-start gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${a.level === 'EXCEEDED' ? 'bg-despesa' : 'bg-dourado'}`} />
                  <div>
                    <div className={`text-sm ${a.readAt ? 'text-apoio' : 'font-semibold text-tinta'}`}>
                      {a.level === 'EXCEEDED' ? 'Passou do combinado' : `Chegou a ${a.thresholdPct}% do combinado`} · {a.limit.name}
                    </div>
                    <div className="text-xs text-apoio">
                      {money(a.consumed)} de {money(a.limit.amount)} ({a.consumedPct}% no disparo) · período {date(a.period.start)}–{date(a.period.end)} · {dateTime(a.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={a.status === 'ACTIVE' ? (a.level === 'EXCEEDED' ? 'red' : 'amber') : 'gray'}>{a.status === 'ACTIVE' ? 'Ativo' : a.status === 'RESOLVED' ? 'Voltou ao combinado' : 'Dispensado'}</Badge>
                  {!a.readAt && a.status === 'ACTIVE' && (
                    <form action={markRead}><input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="id" value={a.id} /><button className="btn-secondary !py-1 text-xs">Marcar como lido</button></form>
                  )}
                  {isAdmin(family.myRole) && a.status === 'ACTIVE' && (
                    <form action={dismiss}><input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="id" value={a.id} /><button className="btn-danger">Dispensar</button></form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty>{history ? 'Ainda não houve alertas.' : 'Nenhum alerta por enquanto. O mês está dentro do combinado.'}</Empty>}
      </Card>
    </>
  );
}
