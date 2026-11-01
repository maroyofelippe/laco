import Link from 'next/link';
import { CategoryChart, MemberChart, TimeseriesChart } from '@/components/Charts';
import { FilterBar } from '@/components/FilterBar';
import { Badge, Card, Empty, LIMIT_STATUS, limitColor, PageHeader, Progress, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { getLookups } from '@/lib/family';
import { date, money, monthLabel, monthRange, PERIOD_LABEL, STATUS_LABEL } from '@/lib/format';

interface Summary { income: string; expense: string; result: string; accountsBalance: string; openCardBills: string; transactionCount: number }
interface ByCategory { total: string; items: { categoryId: string; name: string; color: string | null; amount: string; pct: number }[] }
interface ByMember { items: { userId: string; name: string; expense: string; income: string }[] }
interface Series { series: { month: string; income: string; expense: string; result: string }[] }
interface LimitsVs { items: { id: string; name: string; period: string; amount: string; consumed: string; consumedPct: number; status: string; thresholds: number[]; currentPeriod: { start: string; end: string } | null }[] }
interface Upcoming { items: { id: string; cardName: string; referenceMonth: string; dueDate: string; totalAmount: string; paidAmount: string; status: string; overdue: boolean }[] }
interface Budgets { month: string; totals: { planned: string; actual: string }; items: { categoryId: string; name: string; planned: string; actual: string; usedPct: number | null }[] }

export default async function Dashboard({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const def = monthRange();
  const f = { from: sp.from || def.from, to: sp.to || def.to, categoryId: sp.categoryId, memberId: sp.memberId, accountId: sp.accountId, cardId: sp.cardId };
  const base = `/families/${familyId}/dashboard`;

  const [lookups, summary, byCat, byMember, series, limits, upcoming, budgets] = await Promise.all([
    getLookups(familyId),
    api<Summary>(`${base}/summary`, { query: f }),
    api<ByCategory>(`${base}/by-category`, { query: f }),
    api<ByMember>(`${base}/by-member`, { query: f }),
    api<Series>(`${base}/timeseries`, { query: { ...f, months: 12 } }),
    api<LimitsVs>(`${base}/limits-vs-actual`),
    api<Upcoming>(`${base}/upcoming`),
    api<Budgets>(`${base}/budgets-vs-actual`, { query: { to: f.to } }),
  ]);
  const filtered = Object.entries(f).some(([k, v]) => v && !(k === 'from' && v === def.from) && !(k === 'to' && v === def.to));

  return (
    <>
      <PageHeader title="Como está o mês da família?" subtitle={`${date(f.from)} a ${date(f.to)}${filtered ? ' · com filtros' : ''}`} />
      <FilterBar action={`/f/${familyId}/dashboard`} values={f} {...lookups} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Receitas" value={money(summary.income)} tone="income" />
        <Stat label="Despesas" value={money(summary.expense)} tone="expense" />
        <Stat label="Resultado do período" value={money(summary.result)} tone={Number(summary.result) >= 0 ? 'income' : 'expense'} />
        <Stat label="Saldo nas contas" value={money(summary.accountsBalance)} hint={`em ${date(f.to)}`} highlight />
        <Stat label="Faturas em aberto" value={money(summary.openCardBills)} hint={`${summary.transactionCount} lançamentos no período`} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-5">
        <Card title="Como o dinheiro entrou e saiu · 12 meses" className="lg:col-span-3">
          <TimeseriesChart data={series.series.map((s) => ({ label: monthLabel(s.month), income: Number(s.income), expense: Number(s.expense) }))} />
        </Card>
        <Card title="Para onde foi o dinheiro" className="lg:col-span-2">
          {byCat.items.length ? <CategoryChart data={byCat.items.map((i) => ({ name: i.name, amount: Number(i.amount), color: i.color, pct: i.pct }))} /> : <Empty>Sem despesas no período.</Empty>}
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Limites combinados" actions={<Link href={`/f/${familyId}/limites`} className="text-xs font-medium text-verde">Ver limites</Link>}>
          {limits.items.length ? (
            <ul className="space-y-4">
              {limits.items.map((l) => (
                <li key={l.id}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-tinta">{l.name} <span className="text-xs font-normal text-apoio">· {PERIOD_LABEL[l.period]}</span></span>
                    <Badge color={limitColor(l.status)}>{l.consumedPct}% · {LIMIT_STATUS[l.status]}</Badge>
                  </div>
                  <Progress pct={l.consumedPct} thresholds={l.thresholds} />
                  <div className="mt-1 text-xs text-apoio">{money(l.consumed)} de {money(l.amount)}{l.currentPeriod && ` · ${date(l.currentPeriod.start)}–${date(l.currentPeriod.end)}`}</div>
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum limite combinado ainda. Que tal combinar um para a família?</Empty>}
        </Card>
        <Card title="Gastos por pessoa">
          {byMember.items.length ? <MemberChart data={byMember.items.map((m) => ({ name: m.name, expense: Number(m.expense) }))} /> : <Empty>Sem despesas no período.</Empty>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Planejado e realizado · ${monthLabel(budgets.month)}`} actions={<Link href={`/f/${familyId}/orcamentos`} className="text-xs font-medium text-verde">Editar orçamento</Link>}>
          <table className="table">
            <thead><tr><th>Categoria</th><th className="text-right">Planejado</th><th className="text-right">Realizado</th><th className="w-28">Uso</th></tr></thead>
            <tbody>
              {budgets.items.filter((b) => Number(b.planned) > 0 || Number(b.actual) > 0).map((b) => (
                <tr key={b.categoryId}>
                  <td>{b.name}</td>
                  <td className="text-right tabular text-apoio">{Number(b.planned) ? money(b.planned) : '—'}</td>
                  <td className="text-right tabular">{money(b.actual)}</td>
                  <td>{b.usedPct !== null ? <div className="flex items-center gap-2"><Progress pct={b.usedPct} thresholds={[90, 100]} /><span className="w-10 text-right text-xs tabular text-apoio">{Math.round(b.usedPct)}%</span></div> : <span className="whitespace-nowrap text-xs text-apoio">não planejado</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Próximos vencimentos">
          {upcoming.items.length ? (
            <ul className="divide-y divide-areia">
              {upcoming.items.map((u) => (
                <li key={u.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <div className="font-medium">Fatura {u.cardName} · {monthLabel(u.referenceMonth)}</div>
                    <div className="text-xs text-apoio">vence {date(u.dueDate)}</div>
                  </div>
                  <div className="text-right">
                    <div className="tabular font-medium">{money(Number(u.totalAmount) - Number(u.paidAmount))}</div>
                    <Badge color={u.overdue ? 'red' : u.status === 'CLOSED' ? 'amber' : 'blue'}>{u.overdue ? 'Vencida' : STATUS_LABEL[u.status]}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhuma fatura vencendo nos próximos 45 dias.</Empty>}
        </Card>
      </div>
    </>
  );
}
