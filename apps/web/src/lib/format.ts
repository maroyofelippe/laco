const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v: string | number | null | undefined) => brl.format(Number(v ?? 0));
export const date = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
export const dateTime = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(d)) : '—';
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export const monthRange = (d = todayISO()) => {
  const [y, m] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${d.slice(0, 7)}-01`, to: `${d.slice(0, 7)}-${String(last).padStart(2, '0')}` };
};

export const ROLE_LABEL: Record<string, string> = { OWNER: 'Titular', ADMIN: 'Administrador', MEMBER: 'Membro', VIEWER: 'Leitor' };
export const TYPE_LABEL: Record<string, string> = { INCOME: 'Receita', EXPENSE: 'Despesa', TRANSFER_IN: 'Transf. entrada', TRANSFER_OUT: 'Transf. saída', CARD_PAYMENT: 'Pag. fatura' };
export const SCOPE_LABEL: Record<string, string> = { FAMILY: 'Família', CATEGORY: 'Categoria', ACCOUNT: 'Conta', CARD: 'Cartão', MEMBER: 'Membro' };
export const PERIOD_LABEL: Record<string, string> = { WEEKLY: 'Semanal', MONTHLY: 'Mensal', CARD_CYCLE: 'Ciclo da fatura', CUSTOM: 'Personalizado' };
export const STATUS_LABEL: Record<string, string> = { OPEN: 'Aberta', CLOSED: 'Fechada', PAID: 'Paga', PARTIAL: 'Parcial', OVERDUE: 'Vencida' };
export const isAdmin = (role: string) => role === 'OWNER' || role === 'ADMIN';
