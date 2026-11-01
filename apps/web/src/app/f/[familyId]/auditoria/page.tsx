import { notFound } from 'next/navigation';
import { Card, Empty, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { getFamily } from '@/lib/family';
import { dateTime, isAdmin } from '@/lib/format';

interface AuditPage { data: { id: number; action: string; entityType: string; entityId: string | null; createdAt: string; actorName: string | null }[]; nextCursor: string | null }

const ACTION: Record<string, string> = {
  'family.create': 'Criou a família', 'member.update': 'Alterou membro', 'member.remove': 'Removeu membro', 'member.leave': 'Saiu da família', 'member.permissions': 'Alterou permissões',
  'invitation.create': 'Convidou', 'invitation.accept': 'Aceitou convite', 'invitation.revoke': 'Revogou convite', 'category.create': 'Criou categoria', 'category.update': 'Editou categoria',
  'category.deactivate': 'Desativou categoria', 'category.activate': 'Reativou categoria', 'account.create': 'Criou conta', 'account.update': 'Editou conta', 'account.delete': 'Excluiu conta',
  'card.create': 'Criou cartão', 'card.update': 'Editou cartão', 'transaction.create': 'Criou lançamento', 'transaction.update': 'Editou lançamento', 'transaction.delete': 'Excluiu lançamento',
  'transaction.installments': 'Criou compra parcelada', 'transaction.transfer': 'Fez transferência', 'statement.pay': 'Pagou fatura', 'budget.set': 'Definiu orçamento',
  'limit.create': 'Criou limite', 'limit.update': 'Editou limite', 'limit.deactivate': 'Desativou limite', 'alert.dismiss': 'Dispensou alerta',
};

export default async function AuditPageView({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const family = await getFamily(familyId);
  if (!isAdmin(family.myRole)) notFound();
  const page = await api<AuditPage>(`/families/${familyId}/audit-logs`, { query: { limit: 50, cursor: sp.cursor, entityType: sp.entityType } });
  return (
    <>
      <PageHeader title="Histórico de ações" subtitle="Quem fez o quê na família, para todos acompanharem com transparência." />
      <Card>
        {page.data.length ? (
          <table className="table">
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th></tr></thead>
            <tbody>
              {page.data.map((l) => (
                <tr key={l.id}><td className="whitespace-nowrap text-apoio">{dateTime(l.createdAt)}</td><td>{l.actorName ?? '—'}</td><td>{ACTION[l.action] ?? l.action}</td><td className="font-mono text-xs text-apoio">{l.entityType}{l.entityId ? ` · ${l.entityId.slice(-8)}` : ''}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Sem registros.</Empty>}
        {page.nextCursor && <div className="mt-4 text-right"><a className="btn-secondary" href={`/f/${familyId}/auditoria?cursor=${page.nextCursor}`}>Mais antigos »</a></div>}
      </Card>
    </>
  );
}
