import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge, Banner, Card, PageHeader } from '@/components/ui';
import { runAction, str } from '@/lib/actions';
import { api } from '@/lib/api';
import { getFamily } from '@/lib/family';
import { date, dateTime, isAdmin, ROLE_LABEL } from '@/lib/format';
import { getSession } from '@/lib/server-session';
import type { Member } from '@/lib/types';

interface Invitation { id: string; email: string; role: string; status: string; expiresAt: string; createdAt: string; invitedBy: string }

async function invite(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  let link = '';
  // Sem serviço de e-mail no ambiente local: a API devolve o link e ele aparece no banner
  await runAction(`/f/${familyId}/membros`, () => (link ? `Convite criado. Link (ambiente local): ${link}` : 'Convite enviado'), async () => {
    const r = await api<{ devInviteLink?: string }>(`/families/${familyId}/invitations`, { method: 'POST', body: { email: str(fd, 'email'), role: str(fd, 'role') } });
    link = r.devInviteLink ?? '';
    revalidatePath(`/f/${familyId}/membros`);
  });
}

async function changeRole(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/membros`, 'Papel atualizado', async () => {
    await api(`/families/${familyId}/members/${str(fd, 'userId')}`, { method: 'PATCH', body: { role: str(fd, 'role') } });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function removeMember(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/membros`, 'Pessoa removida da família', async () => {
    await api(`/families/${familyId}/members/${str(fd, 'userId')}`, { method: 'DELETE' });
    revalidatePath(`/f/${familyId}`, 'layout');
  });
}

async function revokeInvite(fd: FormData) {
  'use server';
  const familyId = str(fd, 'familyId')!;
  await runAction(`/f/${familyId}/membros`, 'Convite revogado', async () => {
    await api(`/families/${familyId}/invitations/${str(fd, 'id')}`, { method: 'DELETE' });
  });
}

export default async function MembersPage({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const family = await getFamily(familyId);
  if (!isAdmin(family.myRole)) notFound();
  const [members, invitations, session] = await Promise.all([api<Member[]>(`/families/${familyId}/members`), api<Invitation[]>(`/families/${familyId}/invitations`), getSession()]);
  const isOwner = family.myRole === 'OWNER';
  const roles = isOwner ? ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] : ['MEMBER', 'VIEWER'];

  return (
    <>
      <PageHeader title="Pessoas da família" subtitle="Cada pessoa tem um papel que define o que pode ver e fazer." />
      <Banner ok={sp.ok} err={sp.err} />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card title={`Pessoas (${members.length})`}>
            <div className="-mx-5 overflow-x-auto">
              <table className="table">
                <thead><tr><th>Nome</th><th>Papel</th><th>Status</th><th>Desde</th><th /></tr></thead>
                <tbody>
                  {members.map((m) => {
                    const editable = m.userId !== session?.user.id && (isOwner || (m.role !== 'OWNER' && m.role !== 'ADMIN'));
                    return (
                      <tr key={m.userId}>
                        <td><div className="font-medium">{m.name}</div><div className="text-xs text-apoio">{m.email}</div></td>
                        <td>
                          {editable ? (
                            <form action={changeRole} className="flex items-center gap-1">
                              <input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="userId" value={m.userId} />
                              <select name="role" defaultValue={m.role} className="input !w-36 !py-1">{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                              <button className="btn-secondary !py-1 text-xs">Salvar</button>
                            </form>
                          ) : <Badge color={m.role === 'OWNER' ? 'blue' : 'gray'}>{ROLE_LABEL[m.role]}</Badge>}
                        </td>
                        <td><Badge color={m.status === 'ACTIVE' ? 'green' : 'amber'}>{m.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}</Badge></td>
                        <td className="text-apoio">{date(m.joinedAt)}</td>
                        <td className="text-right">
                          {editable && (
                            <form action={removeMember}><input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="userId" value={m.userId} /><button className="btn-danger">Remover</button></form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Convites">
            <div className="-mx-5 overflow-x-auto">
              <table className="table">
                <thead><tr><th>E-mail</th><th>Papel</th><th>Status</th><th>Expira</th><th>Por</th><th /></tr></thead>
                <tbody>
                  {invitations.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td><td>{ROLE_LABEL[i.role]}</td>
                      <td><Badge color={i.status === 'PENDING' ? 'amber' : i.status === 'ACCEPTED' ? 'green' : 'gray'}>{({ PENDING: 'Pendente', ACCEPTED: 'Aceito', REVOKED: 'Revogado', EXPIRED: 'Expirado' } as Record<string, string>)[i.status]}</Badge></td>
                      <td className="text-apoio">{dateTime(i.expiresAt)}</td><td className="text-apoio">{i.invitedBy}</td>
                      <td className="text-right">{i.status === 'PENDING' && <form action={revokeInvite}><input type="hidden" name="familyId" value={familyId} /><input type="hidden" name="id" value={i.id} /><button className="btn-danger">Revogar</button></form>}</td>
                    </tr>
                  ))}
                  {!invitations.length && <tr><td colSpan={6} className="text-center text-apoio">Nenhum convite enviado.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Convidar alguém" className="h-fit">
          <form action={invite} className="space-y-3">
            <input type="hidden" name="familyId" value={familyId} />
            <div><label className="label" htmlFor="email">E-mail</label><input className="input" type="email" id="email" name="email" required /></div>
            <div><label className="label" htmlFor="role">Papel</label><select className="input" id="role" name="role" defaultValue="MEMBER">{(isOwner ? ['ADMIN', 'MEMBER', 'VIEWER'] : ['MEMBER', 'VIEWER']).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
            <SubmitButton className="btn w-full">Enviar convite</SubmitButton>
            <p className="text-xs text-apoio">O convite vale 7 dias e só pode ser aceito pelo e-mail informado. No ambiente local o link aparece no log da API.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
