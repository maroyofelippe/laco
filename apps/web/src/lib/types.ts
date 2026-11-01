export interface Family { id: string; name: string; currency: string; myRole: string; activeMembers: number }
export interface MyFamily { id: string; name: string; role: string }
export interface Category { id: string; name: string; kind: 'INCOME' | 'EXPENSE' | 'TRANSFER'; parentId: string | null; color: string | null; isSystem: boolean; isActive: boolean }
export interface Account { id: string; type: string; name: string; balance: string; visibility: string; bankCode: string | null }
export interface Statement { id?: string; referenceMonth: string; closingDate: string; dueDate: string; totalAmount: string; paidAmount: string; status: string }
export interface Card { id: string; name: string; brand: string | null; last4: string | null; creditLimit: string; usedLimit: string; availableLimit: string; closingDay: number; dueDay: number; currentStatement: Statement }
export interface Member { userId: string; name: string; email: string; role: string; status: string; joinedAt: string }
export interface Tx {
  id: string; type: string; amount: string; description: string; occurredOn: string; status: string; source: string; version: number;
  category: { id: string; name: string; color: string | null }; account: { id: string; name: string } | null; card: { id: string; name: string } | null;
  member: { id: string; name: string } | null; installment: { number: number } | null; statement: { referenceMonth: string } | null;
}
export interface TxPage { data: Tx[]; totals: { income: string; expense: string }; nextCursor: string | null }
export interface Limit {
  id: string; name: string; scopeType: string; scopeId: string | null; period: string; amount: string; thresholds: number[]; isActive: boolean;
  currentPeriod: { start: string; end: string } | null; consumed: string | null; consumedPct: number | null; status: string;
}
export interface Alert {
  id: string; seq: number; level: 'WARNING' | 'EXCEEDED'; thresholdPct: number; status: string; consumed: string; consumedPct: number;
  limit: { id: string; name: string; amount: string }; period: { start: string; end: string }; createdAt: string; readAt: string | null;
}
export interface AlertPage { data: Alert[]; cursor: number; unreadCount: number }
