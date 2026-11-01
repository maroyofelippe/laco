import { revalidatePath } from 'next/cache';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Banner, Card, Empty, PageHeader, Progress } from '@/components/ui';
import { moneyField, runAction, str } from '@/lib/actions';
import { api } from '@/lib/api';
import { getFamily, getLookups } from '@/lib/family';
import { date, isAdmin, money, monthLabel, STATUS_LABEL, todayISO } from '@/lib/format';
import type { Statement } from '@/lib/types';

async function createAccount(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/contas`, 'Conta criada', async () => {
    await api(`/families/${familyId}/accounts`, { method: 'POST', body: { type: str(fd, 'type'), name: str(fd, 'name'), openingBalance: moneyField(fd, 'openingBalance') ?? '0.00', openingDate: str(fd, 'openingDate'), visibility: str(fd, 'visibility') } });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function createCard(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/contas`, 'Cartão criado', async () => {
    await api(`/families/${familyId}/cards`, { method: 'POST', body: { name: str(fd, 'name'), last4: str(fd, 'last4'), creditLimit: moneyField(fd, 'creditLimit'), closingDay: Number(str(fd, 'closingDay')), dueDay: Number(str(fd, 'dueDay')), paymentAccountId: str(fd, 'paymentAccountId') } });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

const TYPE: Record<string, string> = { CHECKING: 'Conta corrente', SAVINGS: 'Poupança', CASH: 'Dinheiro' };

export default async function AccountsPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const [family, { accounts, cards }] = await Promise.all([getFamily(familyId), getLookups(familyId)]);
  const statements = await Promise.all(cards.map((c) => api<Statement[]>(`/families/${familyId}/cards/${c.id}/statements`)));
  const admin = isAdmin(family.myRole);
  const total = accounts.reduce((s, a) => s + Number(a.balance), 0);

  return (
    <>
      <PageHeader title="Contas e cartões" subtitle={`Saldo total visível: ${money(total)}`} />
      <Banner ok={sp.ok} err={sp.err} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <div key={a.id} className="rounded-lg border border-borda bg-superficie p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-apoio">{TYPE[a.type]}</span>
              {a.visibility === 'RESTRICTED' && <Badge color="amber">Restrita</Badge>}
            </div>
            <div className="mt-1 font-medium">{a.name}</div>
            <div className={`mt-2 text-xl font-semibold tabular ${Number(a.balance) < 0 ? 'text-despesa' : 'text-tinta'}`}>{money(a.balance)}</div>
          </div>
        ))}
        {!accounts.length && <Empty>Nenhuma conta visível.</Empty>}
      </div>

      <div className="mb-6 space-y-6">
        {cards.map((c, i) => {
          const usedPct = Number(c.creditLimit) > 0 ? Math.round((Number(c.usedLimit) / Number(c.creditLimit)) * 100) : 0;
          return (
            <Card key={c.id} title={`${c.name}${c.last4 ? ` · final ${c.last4}` : ''}`} actions={<span className="text-xs text-apoio">fecha dia {c.closingDay} · vence dia {c.dueDay}</span>}>
              <div className="mb-4 grid gap-4 sm:grid-cols-3">
                <div><div className="text-xs text-apoio">Limite usado</div><div className="font-semibold tabular">{money(c.usedLimit)} <span className="text-xs font-normal text-apoio">de {money(c.creditLimit)}</span></div><div className="mt-1"><Progress pct={usedPct} thresholds={[70, 90]} /></div></div>
                <div><div className="text-xs text-apoio">Disponível</div><div className="font-semibold tabular text-receita">{money(c.availableLimit)}</div></div>
                <div><div className="text-xs text-apoio">Fatura atual ({monthLabel(c.currentStatement.referenceMonth)})</div><div className="font-semibold tabular">{money(c.currentStatement.totalAmount)}</div><div className="text-xs text-apoio">vence {date(c.currentStatement.dueDate)}</div></div>
              </div>
              <div className="-mx-5 overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Fatura</th><th>Fechamento</th><th>Vencimento</th><th className="text-right">Total</th><th className="text-right">Pago</th><th>Status</th></tr></thead>
                  <tbody>
                    {statements[i].slice(0, 8).map((s) => (
                      <tr key={s.id}>
                        <td>{monthLabel(s.referenceMonth)}</td><td className="text-apoio">{date(s.closingDate)}</td><td className="text-apoio">{date(s.dueDate)}</td>
                        <td className="text-right tabular">{money(s.totalAmount)}</td><td className="text-right tabular text-apoio">{money(s.paidAmount)}</td>
                        <td><Badge color={s.status === 'PAID' ? 'green' : s.status === 'OVERDUE' ? 'red' : s.status === 'CLOSED' ? 'amber' : 'blue'}>{STATUS_LABEL[s.status]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

      {admin && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Nova conta">
            <form action={createAccount} className="grid grid-cols-2 gap-3">
              <input type="hidden" name="familyId" value={familyId} />
              <div className="col-span-2"><label className="label" htmlFor="acc-name">Nome</label><input className="input" id="acc-name" name="name" required /></div>
              <div><label className="label" htmlFor="acc-type">Tipo</label><select className="input" id="acc-type" name="type">{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label className="label" htmlFor="acc-vis">Visibilidade</label><select className="input" id="acc-vis" name="visibility"><option value="FAMILY">Toda a família</option><option value="RESTRICTED">Restrita</option></select></div>
              <div><label className="label" htmlFor="acc-ob">Saldo inicial</label><input className="input" id="acc-ob" name="openingBalance" defaultValue="0,00" /></div>
              <div><label className="label" htmlFor="acc-od">Data do saldo</label><input className="input" type="date" id="acc-od" name="openingDate" defaultValue={todayISO()} /></div>
              <div className="col-span-2"><SubmitButton>Criar conta</SubmitButton></div>
            </form>
          </Card>
          <Card title="Novo cartão">
            <form action={createCard} className="grid grid-cols-2 gap-3">
              <input type="hidden" name="familyId" value={familyId} />
              <div><label className="label" htmlFor="c-name">Nome</label><input className="input" id="c-name" name="name" required /></div>
              <div><label className="label" htmlFor="c-last4">Final (4 dígitos)</label><input className="input" id="c-last4" name="last4" pattern="\d{4}" maxLength={4} /></div>
              <div><label className="label" htmlFor="c-limit">Limite</label><input className="input" id="c-limit" name="creditLimit" required /></div>
              <div><label className="label" htmlFor="c-pay">Conta de pagamento</label><select className="input" id="c-pay" name="paymentAccountId"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
              <div><label className="label" htmlFor="c-close">Dia de fechamento</label><input className="input" type="number" min={1} max={31} id="c-close" name="closingDay" required /></div>
              <div><label className="label" htmlFor="c-due">Dia de vencimento</label><input className="input" type="number" min={1} max={31} id="c-due" name="dueDay" required /></div>
              <div className="col-span-2"><SubmitButton>Criar cartão</SubmitButton></div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
