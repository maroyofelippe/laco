import type { Account, Card, Category, Member } from '@/lib/types';

/** Filtros via GET: o estado fica na URL, então a visão pode ser compartilhada e recarregada. */
export function FilterBar({
  action, values, categories, members, accounts, cards, extra,
}: {
  action: string;
  values: Record<string, string | undefined>;
  categories: Category[];
  members: Member[];
  accounts: Account[];
  cards: Card[];
  extra?: React.ReactNode;
}) {
  const roots = categories.filter((c) => !c.parentId && c.kind !== 'TRANSFER');
  return (
    <form action={action} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-borda bg-superficie p-4 md:grid-cols-4 lg:grid-cols-7">
      <div>
        <label className="label" htmlFor="from">De</label>
        <input className="input" type="date" id="from" name="from" defaultValue={values.from} />
      </div>
      <div>
        <label className="label" htmlFor="to">Até</label>
        <input className="input" type="date" id="to" name="to" defaultValue={values.to} />
      </div>
      <div>
        <label className="label" htmlFor="categoryId">Categoria</label>
        <select className="input" id="categoryId" name="categoryId" defaultValue={values.categoryId ?? ''}>
          <option value="">Todas</option>
          {roots.map((c) => (
            <optgroup key={c.id} label={c.name}>
              <option value={c.id}>{c.name} (todas)</option>
              {categories.filter((s) => s.parentId === c.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="memberId">Membro</label>
        <select className="input" id="memberId" name="memberId" defaultValue={values.memberId ?? ''}>
          <option value="">Todos</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="accountId">Conta</label>
        <select className="input" id="accountId" name="accountId" defaultValue={values.accountId ?? ''}>
          <option value="">Todas</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="cardId">Cartão</label>
        <select className="input" id="cardId" name="cardId" defaultValue={values.cardId ?? ''}>
          <option value="">Todos</option>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {extra}
      <div className="flex items-end gap-2">
        <button className="btn w-full" type="submit">Filtrar</button>
        <a href={action} className="btn-secondary" title="Limpar filtros">✕</a>
      </div>
    </form>
  );
}
