import { revalidatePath } from 'next/cache';
import { SubmitButton } from '@/components/SubmitButton';
import { Banner, Card, PageHeader, Progress } from '@/components/ui';
import { moneyField, runAction, str } from '@/lib/actions';
import { api } from '@/lib/api';
import { getFamily } from '@/lib/family';
import { isAdmin, money, monthLabel, todayISO } from '@/lib/format';

interface Budgets { month: string; totals: { planned: string; actual: string; remaining: string }; items: { categoryId: string; name: string; color: string | null; planned: string; actual: string; remaining: string; usedPct: number | null }[] }

async function saveBudgets(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  const month = str(fd, 'month')!;
  const items = [...fd.keys()].filter((k) => k.startsWith('b_')).map((k) => ({ categoryId: k.slice(2), plannedAmount: moneyField(fd, k) ?? '0' }));
  await runAction(`/f/${familyId}/orcamentos?month=${month}`, 'Orçamento salvo', async () => {
    await api(`/families/${familyId}/budgets`, { method: 'PUT', query: { month }, body: { items } });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

export default async function BudgetsPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const month = sp.month ?? todayISO().slice(0, 7);
  const [family, b] = await Promise.all([getFamily(familyId), api<Budgets>(`/families/${familyId}/budgets`, { query: { month } })]);
  const admin = isAdmin(family.myRole);
  return (
    <>
      <PageHeader
        title={`Orçamento · ${monthLabel(month)}`}
        subtitle={`Planejado ${money(b.totals.planned)} · já usado ${money(b.totals.actual)} · ainda livre ${money(b.totals.remaining)}`}
        actions={<form className="flex gap-2"><input className="input" type="month" name="month" defaultValue={month} /><button className="btn-secondary">Ver</button></form>}
      />
      <Banner ok={sp.ok} err={sp.err} />
      <Card>
        <form action={saveBudgets}>
          <input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="month" value={month} />
          <table className="table">
            <thead><tr><th>Categoria</th><th className="w-40">Planejado (R$)</th><th className="text-right">Realizado</th><th className="text-right">Ainda livre</th><th className="w-44">Uso</th></tr></thead>
            <tbody>
              {b.items.map((i) => (
                <tr key={i.categoryId}>
                  <td><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color ?? '#94a3b8' }} />{i.name}</span></td>
                  <td>{admin ? <input className="input !py-1 text-right" name={`b_${i.categoryId}`} defaultValue={Number(i.planned) ? i.planned : ''} placeholder="—" inputMode="decimal" /> : money(i.planned)}</td>
                  <td className="text-right tabular">{money(i.actual)}</td>
                  <td className={`text-right tabular ${Number(i.remaining) < 0 ? 'text-despesa' : 'text-apoio'}`}>{Number(i.planned) ? money(i.remaining) : '—'}</td>
                  <td>{i.usedPct !== null ? <div className="flex items-center gap-2"><Progress pct={i.usedPct} thresholds={[90, 100]} /><span className="w-12 text-right text-xs tabular">{Math.round(i.usedPct)}%</span></div> : <span className="whitespace-nowrap text-xs text-apoio">não planejado</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {admin && <div className="mt-4 flex justify-end"><SubmitButton>Salvar orçamento</SubmitButton></div>}
        </form>
      </Card>
    </>
  );
}
