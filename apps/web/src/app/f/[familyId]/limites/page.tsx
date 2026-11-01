import { revalidatePath } from 'next/cache';
import { LimitScopeFields } from '@/components/LimitScopeFields';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Banner, Card, Empty, LIMIT_STATUS, limitColor, PageHeader, Progress } from '@/components/ui';
import { moneyField, runAction, str } from '@/lib/actions';
import { api } from '@/lib/api';
import { getFamily, getLookups } from '@/lib/family';
import { date, isAdmin, money, PERIOD_LABEL, SCOPE_LABEL } from '@/lib/format';
import type { Limit } from '@/lib/types';

async function createLimit(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  const scopeType = str(fd, 'scopeType')!;
  const thresholds = (str(fd, 'thresholds') ?? '80,100').split(',').map((s) => Number(s.trim())).filter(Boolean);
  await runAction(`/f/${familyId}/limites`, 'Limite combinado. Vamos avisar a família quando estiver chegando perto.', async () => {
    await api(`/families/${familyId}/limits`, {
      method: 'POST',
      body: {
        name: str(fd, 'name'), scopeType, scopeId: scopeType === 'FAMILY' ? undefined : str(fd, 'scopeId'),
        period: str(fd, 'period'), amount: moneyField(fd, 'amount'), thresholds,
        customStart: str(fd, 'customStart'), customEnd: str(fd, 'customEnd'),
      },
    });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function updateLimit(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/limites`, 'Valor do limite atualizado', async () => {
    await api(`/families/${familyId}/limits/${str(fd, 'id')}`, { method: 'PATCH', body: { amount: moneyField(fd, 'amount') } });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function toggleLimit(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  const active = str(fd, 'active') === 'true';
  await runAction(`/f/${familyId}/limites`, active ? 'Limite pausado' : 'Limite retomado', async () => {
    await api(`/families/${familyId}/limits/${str(fd, 'id')}`, { method: 'PATCH', body: { isActive: !active } });
  });
}

export default async function LimitsPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const [family, lookups, limits] = await Promise.all([getFamily(familyId), getLookups(familyId), api<Limit[]>(`/families/${familyId}/limits`)]);
  const admin = isAdmin(family.myRole);
  const expenseRoots = lookups.categories.filter((c) => c.kind === 'EXPENSE' && !c.parentId);
  const scopeName = (l: Limit) => {
    if (l.scopeType === 'FAMILY') return 'Toda a família';
    const all = [...lookups.categories.map((c) => ({ id: c.id, name: c.name })), ...lookups.accounts, ...lookups.cards, ...lookups.members.map((m) => ({ id: m.userId, name: m.name }))];
    return all.find((x) => x.id === l.scopeId)?.name ?? '—';
  };

  return (
    <>
      <PageHeader title="Limites combinados" subtitle="Combinem quanto a família quer gastar em cada área. Avisamos uma única vez em cada faixa: quando estiver perto e se passar do combinado." />
      <Banner ok={sp.ok} err={sp.err} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          {limits.length ? (
            <ul className="divide-y divide-areia">
              {limits.map((l) => (
                <li key={l.id} className={`py-4 ${l.isActive ? '' : 'opacity-50'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-tinta">{l.name}</div>
                      <div className="text-xs text-apoio">{SCOPE_LABEL[l.scopeType]}: {scopeName(l)} · {PERIOD_LABEL[l.period]} · avisos em {l.thresholds.join('% e ')}%</div>
                    </div>
                    <Badge color={l.isActive ? limitColor(l.status) : 'gray'}>{l.isActive ? `${l.consumedPct}% · ${LIMIT_STATUS[l.status]}` : 'Pausado'}</Badge>
                  </div>
                  {l.isActive && l.consumedPct !== null && (
                    <div className="mt-2">
                      <Progress pct={l.consumedPct} thresholds={l.thresholds} />
                      <div className="mt-1 text-xs text-apoio">{money(l.consumed)} de {money(l.amount)}{l.currentPeriod && ` · período ${date(l.currentPeriod.start)} a ${date(l.currentPeriod.end)}`}</div>
                    </div>
                  )}
                  {admin && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <form action={updateLimit} className="flex items-center gap-1">
                        <input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="id" value={l.id} />
                        <input className="input !w-28 !py-1" name="amount" defaultValue={l.amount} aria-label="Novo valor" />
                        <button className="btn-secondary !py-1 text-xs">Alterar valor</button>
                      </form>
                      <form action={toggleLimit}>
                        <input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="id" value={l.id} /><input type="hidden" name="active" value={String(l.isActive)} />
                        <button className="btn-secondary !py-1 text-xs">{l.isActive ? 'Pausar' : 'Retomar'}</button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum limite combinado ainda. Comece pelas áreas que mais pesam no mês.</Empty>}
        </Card>

        {admin && (
          <Card title="Combinar novo limite" className="h-fit">
            <form action={createLimit} className="space-y-3">
              <input type="hidden" name="familyId" value={familyId} />
              <div><label className="label" htmlFor="name">Nome</label><input className="input" id="name" name="name" required placeholder="ex.: Mercado mensal" /></div>
              <LimitScopeFields
                categories={expenseRoots.flatMap((r) => [{ id: r.id, name: r.name }, ...lookups.categories.filter((c) => c.parentId === r.id).map((c) => ({ id: c.id, name: c.name, child: true }))])}
                accounts={lookups.accounts.map((a) => ({ id: a.id, name: a.name }))}
                cards={lookups.cards.map((c) => ({ id: c.id, name: c.name }))}
                members={lookups.members.map((m) => ({ id: m.userId, name: m.name }))}
              />
              <div><label className="label" htmlFor="amount">Valor (R$)</label><input className="input" id="amount" name="amount" required inputMode="decimal" placeholder="0,00" /></div>
              <div><label className="label" htmlFor="thresholds">Faixas de alerta (%)</label><input className="input" id="thresholds" name="thresholds" defaultValue="80,100" /></div>
              <SubmitButton className="btn w-full">Combinar limite</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
