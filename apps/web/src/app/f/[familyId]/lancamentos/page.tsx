import { revalidatePath } from 'next/cache';
import { FilterBar } from '@/components/FilterBar';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Banner, Card, Empty, PageHeader } from '@/components/ui';
import { moneyField, runAction, str } from '@/lib/actions';
import { api } from '@/lib/api';
import { getFamily, getLookups } from '@/lib/family';
import { date, money, monthRange, todayISO, TYPE_LABEL } from '@/lib/format';
import type { TxPage } from '@/lib/types';

async function createTx(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  const means = str(fd, 'means') ?? '';
  const [kind, meansId] = means.split(':');
  const installments = Number(str(fd, 'installments') ?? '1');
  const common = { categoryId: str(fd, 'categoryId'), memberUserId: str(fd, 'memberUserId'), ...(kind === 'card' ? { cardId: meansId } : { accountId: meansId }) };
  await runAction(`/f/${familyId}/lancamentos`, 'Lançamento salvo', async () => {
    if (installments > 1) {
      await api(`/families/${familyId}/transactions/installments`, { method: 'POST', body: { ...common, description: str(fd, 'description'), totalAmount: moneyField(fd, 'amount'), installments, firstDate: str(fd, 'occurredOn') } });
    } else {
      await api(`/families/${familyId}/transactions`, { method: 'POST', body: { ...common, type: str(fd, 'type'), amount: moneyField(fd, 'amount'), description: str(fd, 'description'), occurredOn: str(fd, 'occurredOn') } });
    }
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function deleteTx(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(str(fd, 'back') ?? `/f/${familyId}/lancamentos`, 'Lançamento excluído', async () => {
    await api(`/families/${familyId}/transactions/${str(fd, 'id')}`, { method: 'DELETE' });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

export default async function TransactionsPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const def = monthRange();
  const f = { from: sp.from || def.from, to: sp.to || def.to, categoryId: sp.categoryId, memberId: sp.memberId, accountId: sp.accountId, cardId: sp.cardId, type: sp.type, q: sp.q };
  const [family, lookups, page] = await Promise.all([
    getFamily(familyId),
    getLookups(familyId),
    api<TxPage>(`/families/${familyId}/transactions`, { query: { ...f, limit: 25, cursor: sp.cursor } }),
  ]);
  const canWrite = family.myRole !== 'VIEWER';
  const back = `/f/${familyId}/lancamentos?${new URLSearchParams(Object.entries({ ...f, cursor: sp.cursor }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const nextHref = page.nextCursor ? `${back.replace(/&?cursor=[^&]*/, '')}&cursor=${page.nextCursor}` : null;
  const expenseCats = lookups.categories.filter((c) => c.kind === 'EXPENSE');
  const incomeCats = lookups.categories.filter((c) => c.kind === 'INCOME');
  const label = (id: string) => {
    const c = lookups.categories.find((x) => x.id === id)!;
    const p = c.parentId ? lookups.categories.find((x) => x.id === c.parentId) : null;
    return p ? `${p.name} › ${c.name}` : c.name;
  };

  return (
    <>
      <PageHeader title="Lançamentos" subtitle="Tudo o que entrou e saiu, conforme o que você pode ver." />
      <Banner ok={sp.ok} err={sp.err} />
      <FilterBar
        action={`/f/${familyId}/lancamentos`}
        values={f}
        {...lookups}
        extra={
          <>
            <div>
              <label className="label" htmlFor="type">Tipo</label>
              <select className="input" id="type" name="type" defaultValue={f.type ?? ''}>
                <option value="">Todos</option>
                <option value="EXPENSE">Despesas</option>
                <option value="INCOME">Receitas</option>
                <option value="TRANSFER_OUT">Transferências</option>
                <option value="CARD_PAYMENT">Pagamentos de fatura</option>
              </select>
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="label" htmlFor="q">Busca</label>
              <input className="input" id="q" name="q" placeholder="ex.: mercado" defaultValue={f.q} />
            </div>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card
          title={`${page.data.length} lançamento(s) nesta página`}
          actions={<span className="text-xs text-apoio">Total do filtro: <b className="text-receita">{money(page.totals.income)}</b> · <b className="text-despesa">{money(page.totals.expense)}</b></span>}
        >
          {page.data.length ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Meio</th><th>Membro</th><th className="text-right">Valor</th><th /></tr></thead>
                <tbody>
                  {page.data.map((t) => {
                    const negative = ['EXPENSE', 'TRANSFER_OUT', 'CARD_PAYMENT'].includes(t.type);
                    return (
                      <tr key={t.id}>
                        <td className="whitespace-nowrap text-apoio">{date(t.occurredOn)}</td>
                        <td>
                          <div className="font-medium text-tinta">{t.description}</div>
                          <div className="mt-0.5 flex gap-1">
                            {t.type !== 'EXPENSE' && t.type !== 'INCOME' && <Badge>{TYPE_LABEL[t.type]}</Badge>}
                            {t.occurredOn > todayISO() && <Badge color="amber">Agendado</Badge>}
                            {t.source === 'RECEIPT_OCR' && <Badge color="blue">Nota fiscal</Badge>}
                          </div>
                        </td>
                        <td><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: t.category.color ?? '#94a3b8' }} />{t.category.name}</span></td>
                        <td className="text-apoio">{t.card ? <span>{t.card.name} <span className="text-xs text-apoio">· cartão</span></span> : t.account?.name}</td>
                        <td className="text-apoio">{t.member?.name ?? '—'}</td>
                        <td className={`whitespace-nowrap text-right font-medium tabular ${negative ? 'text-despesa' : 'text-receita'}`}>{negative ? '−' : '+'} {money(t.amount)}</td>
                        <td className="text-right">
                          {canWrite && (
                            <form action={deleteTx}>
                              <input type="hidden" name="familyId" value={familyId} />
                              <input type="hidden" name="id" value={t.id} />
                              <input type="hidden" name="back" value={back} />
                              <button className="btn-danger" title="Excluir">Excluir</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nada encontrado com esses filtros. Tente ampliar o período.</Empty>}
          <div className="mt-4 flex justify-between">
            {sp.cursor ? <a className="btn-secondary" href={back.replace(/&?cursor=[^&]*/, '')}>« Início</a> : <span />}
            {nextHref && <a className="btn-secondary" href={nextHref}>Próxima página »</a>}
          </div>
        </Card>

        {canWrite && (
          <Card title="Novo lançamento" className="h-fit">
            <form action={createTx} className="space-y-3">
              <input type="hidden" name="familyId" value={familyId} />
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 rounded-md border border-borda px-3 py-2 text-sm has-[:checked]:border-despesa has-[:checked]:bg-despesa-claro"><input type="radio" name="type" value="EXPENSE" defaultChecked /> Despesa</label>
                <label className="flex items-center gap-2 rounded-md border border-borda px-3 py-2 text-sm has-[:checked]:border-receita has-[:checked]:bg-verde-claro"><input type="radio" name="type" value="INCOME" /> Receita</label>
              </div>
              <div><label className="label" htmlFor="nt-amount">Valor (R$)</label><input className="input" id="nt-amount" name="amount" inputMode="decimal" placeholder="0,00" required /></div>
              <div><label className="label" htmlFor="nt-description">Descrição</label><input className="input" id="nt-description" name="description" required maxLength={200} /></div>
              <div>
                <label className="label" htmlFor="nt-categoryId">Categoria (obrigatória)</label>
                <select className="input" id="nt-categoryId" name="categoryId" required defaultValue="">
                  <option value="" disabled>Selecione…</option>
                  <optgroup label="Despesas">{expenseCats.map((c) => <option key={c.id} value={c.id}>{label(c.id)}</option>)}</optgroup>
                  <optgroup label="Receitas">{incomeCats.map((c) => <option key={c.id} value={c.id}>{label(c.id)}</option>)}</optgroup>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="nt-means">Conta ou cartão</label>
                <select className="input" id="nt-means" name="means" required>
                  <optgroup label="Contas">{lookups.accounts.map((a) => <option key={a.id} value={`acc:${a.id}`}>{a.name}</option>)}</optgroup>
                  <optgroup label="Cartões">{lookups.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}</optgroup>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label" htmlFor="nt-occurredOn">Data</label><input className="input" type="date" id="nt-occurredOn" name="occurredOn" defaultValue={todayISO()} required /></div>
                <div><label className="label" htmlFor="nt-installments">Parcelas</label><input className="input" type="number" id="nt-installments" name="installments" min={1} max={72} defaultValue={1} /></div>
              </div>
              <div>
                <label className="label" htmlFor="nt-memberUserId">Membro</label>
                <select className="input" id="nt-memberUserId" name="memberUserId">{lookups.members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
              </div>
              <SubmitButton className="btn w-full">Salvar lançamento</SubmitButton>
              <p className="text-xs text-apoio">Parcelado: o valor informado é o total e só vale para despesas.</p>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
