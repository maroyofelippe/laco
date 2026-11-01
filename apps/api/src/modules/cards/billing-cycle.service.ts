import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { addMonths, dateInMonth, fromCents, monthOf, newId, toCents, today } from '../../common/util';
import type { Db } from '../../db/database';
import type { CreditCard } from '../../db/types';

export interface StatementDates {
  referenceMonth: string; // mês do vencimento ('2026-11')
  closingDate: string;
  dueDate: string;
}

/**
 * Regras de fatura:
 * - compra ANTES do dia de fechamento entra na fatura que fecha naquele mês; no dia ou depois, na seguinte;
 * - vencimento no mesmo mês do fechamento se due_day > closing_day, senão no mês seguinte;
 * - a fatura é identificada pelo mês de vencimento.
 */
@Injectable()
export class BillingCycleService {
  datesFor(card: Pick<CreditCard, 'closing_day' | 'due_day'>, purchaseDate: string): StatementDates {
    const ym = monthOf(purchaseDate);
    let closing = dateInMonth(ym, card.closing_day);
    if (purchaseDate >= closing) closing = dateInMonth(monthOf(addMonths(`${ym}-01`, 1)), card.closing_day);
    const dueMonth = card.due_day > card.closing_day ? monthOf(closing) : monthOf(addMonths(`${monthOf(closing)}-01`, 1));
    const due = dateInMonth(dueMonth, card.due_day);
    return { referenceMonth: monthOf(due), closingDate: closing, dueDate: due };
  }

  async getOrCreate(trx: Db, card: CreditCard, purchaseDate: string): Promise<string> {
    const d = this.datesFor(card, purchaseDate);
    await trx
      .insertInto('card_statements')
      .ignore()
      .values({ id: newId(), family_id: card.family_id, card_id: card.id, reference_month: d.referenceMonth, closing_date: d.closingDate, due_date: d.dueDate })
      .execute();
    const row = await trx
      .selectFrom('card_statements')
      .select('id')
      .where('card_id', '=', card.id)
      .where('reference_month', '=', d.referenceMonth)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** Recalcula total (despesas − estornos) e status da fatura. */
  async recalc(trx: Db, familyId: string, statementId: string | null | undefined) {
    if (!statementId) return;
    const sums = await trx
      .selectFrom('transactions')
      .select([
        sql<string>`COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END), 0)`.as('exp'),
        sql<string>`COALESCE(SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END), 0)`.as('refund'),
      ])
      .where('family_id', '=', familyId)
      .where('statement_id', '=', statementId)
      .where('card_id', 'is not', null)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    const paid = await trx
      .selectFrom('transactions')
      .select(sql<string>`COALESCE(SUM(amount), 0)`.as('paid'))
      .where('family_id', '=', familyId)
      .where('statement_id', '=', statementId)
      .where('type', '=', 'CARD_PAYMENT')
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    const st = await trx.selectFrom('card_statements').selectAll().where('id', '=', statementId).executeTakeFirstOrThrow();
    const total = Math.max(0, toCents(sums.exp) - toCents(sums.refund));
    const paidC = toCents(paid.paid);
    const now = today();
    let status: 'OPEN' | 'CLOSED' | 'PAID' | 'PARTIAL' | 'OVERDUE';
    if (total > 0 && paidC >= total) status = 'PAID';
    else if (now > st.due_date && paidC < total) status = 'OVERDUE';
    else if (paidC > 0) status = 'PARTIAL';
    else status = now >= st.closing_date ? 'CLOSED' : 'OPEN';
    await trx
      .updateTable('card_statements')
      .set({ total_amount: fromCents(total), paid_amount: fromCents(paidC), status })
      .where('id', '=', statementId)
      .execute();
  }
}
