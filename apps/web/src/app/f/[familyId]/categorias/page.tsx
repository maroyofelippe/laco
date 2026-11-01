import { revalidatePath } from 'next/cache';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Banner, Card, PageHeader } from '@/components/ui';
import { runAction, str } from '@/lib/actions';
import { api } from '@/lib/api';
import { getFamily } from '@/lib/family';
import { isAdmin } from '@/lib/format';
import type { Category } from '@/lib/types';

async function createCategory(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/categorias`, 'Categoria criada', async () => {
    await api(`/families/${familyId}/categories`, { method: 'POST', body: { name: str(fd, 'name'), kind: str(fd, 'kind'), parentId: str(fd, 'parentId'), color: str(fd, 'color') } });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function toggleCategory(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  const active = str(fd, 'active') === 'true';
  await runAction(`/f/${familyId}/categorias`, active ? 'Categoria desativada' : 'Categoria reativada', async () => {
    await api(`/families/${familyId}/categories/${str(fd, 'id')}/${active ? 'deactivate' : 'activate'}`, { method: 'POST' });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function renameCategory(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/categorias`, 'Categoria renomeada', async () => {
    await api(`/families/${familyId}/categories/${str(fd, 'id')}`, { method: 'PATCH', body: { name: str(fd, 'name') } });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

export default async function CategoriesPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const [family, cats] = await Promise.all([getFamily(familyId), api<Category[]>(`/families/${familyId}/categories`, { query: { includeInactive: 'true' } })]);
  const admin = isAdmin(family.myRole);

  const Row = ({ c, child }: { c: Category; child?: boolean }) => (
    <li className={`flex items-center justify-between gap-2 py-1.5 ${child ? 'pl-6' : ''} ${c.isActive ? '' : 'opacity-50'}`}>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color ?? '#94a3b8' }} />
        {admin && !c.isSystem ? (
          <form action={renameCategory} className="flex items-center gap-1">
            <input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="id" value={c.id} />
            <input name="name" defaultValue={c.name} className="w-44 rounded border border-transparent px-1 py-0.5 hover:border-borda focus:border-verde focus:outline-none" aria-label="Nome da categoria" />
          </form>
        ) : <span className={child ? '' : 'font-medium'}>{c.name}</span>}
        {c.isSystem && <Badge>sistema</Badge>}
        {!c.isActive && <Badge color="gray">inativa</Badge>}
      </span>
      {admin && !c.isSystem && (
        <form action={toggleCategory}>
          <input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(c.isActive)} />
          <button className="btn-danger">{c.isActive ? 'Desativar' : 'Reativar'}</button>
        </form>
      )}
    </li>
  );

  const section = (kind: Category['kind'], title: string) => {
    const roots = cats.filter((c) => c.kind === kind && !c.parentId);
    return (
      <Card title={title}>
        <ul className="divide-y divide-areia">
          {roots.map((r) => (
            <li key={r.id}>
              <ul><Row c={r} />{cats.filter((c) => c.parentId === r.id).map((c) => <Row key={c.id} c={c} child />)}</ul>
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  return (
    <>
      <PageHeader title="Categorias" subtitle="Toda receita e despesa exige categoria. Desativar preserva os lançamentos antigos." />
      <Banner ok={sp.ok} err={sp.err} />
      <div className="grid gap-6 lg:grid-cols-3">
        {section('EXPENSE', 'Despesas')}
        <div className="space-y-6">
          {section('INCOME', 'Receitas')}
          {section('TRANSFER', 'Sistema')}
        </div>
        {admin && (
          <Card title="Nova categoria" className="h-fit">
            <form action={createCategory} className="space-y-3">
              <input type="hidden" name="familyId" value={familyId} />
              <div><label className="label" htmlFor="name">Nome</label><input className="input" id="name" name="name" required maxLength={60} /></div>
              <div><label className="label" htmlFor="kind">Tipo</label><select className="input" id="kind" name="kind"><option value="EXPENSE">Despesa</option><option value="INCOME">Receita</option></select></div>
              <div>
                <label className="label" htmlFor="parentId">Categoria pai (opcional)</label>
                <select className="input" id="parentId" name="parentId"><option value="">— nenhuma —</option>{cats.filter((c) => !c.parentId && c.kind !== 'TRANSFER' && c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind === 'EXPENSE' ? 'despesa' : 'receita'})</option>)}</select>
              </div>
              <div><label className="label" htmlFor="color">Cor</label><input className="input !h-10 !p-1" type="color" id="color" name="color" defaultValue="#5B8E7D" /></div>
              <SubmitButton className="btn w-full">Criar categoria</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
