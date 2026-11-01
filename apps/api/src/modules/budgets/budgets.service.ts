import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { FamilyContext } from '../../common/context';
import { dateInMonth, daysInMonth, fromCents, toCents } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import { applyTxFilter } from '../dashboard/tx-filter';

@Injectable()
export class BudgetsService {
  constructor(@InjectDb() private readonly db: Db, private readonly vis: VisibilityService) {}

  /** Categorias de despesa (nível 1) com orçado e realizado (subcategorias incluídas) no mês. */
  async monthView(ctx: FamilyContext, month: string) {
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = dateInMonth(month, daysInMonth(y, m));
    const cats = await this.db
      .selectFrom('categories')
      .select(['id', 'name', 'color'])
      .where('family_id', '=', ctx.familyId)
      .where('kind', '=', 'EXPENSE')
      .where('parent_id', 'is', null)
      .where('is_active', '=', 1)
      .orderBy('name')
      .execute();
    const planned = new Map(
      (await this.db.selectFrom('budgets').select(['category_id', 'planned_amount']).where('family_id', '=', ctx.familyId).where('reference_month', '=', month).execute()).map((b) => [b.category_id, b.planned_amount]),
    );
    const q = await applyTxFilter(this.db.selectFrom('transactions as t').innerJoin('categories as c', 'c.id', 't.category_id'), ctx, { from, to }, this.vis);
    const actualRows = q
      ? await q
          .select([sql<string>`COALESCE(c.parent_id, c.id)`.as('root'), sql<string>`SUM(t.amount)`.as('amount')])
          .where('t.type', '=', 'EXPENSE')
          .groupBy(sql`COALESCE(c.parent_id, c.id)`)
          .execute()
      : [];
    const actual = new Map(actualRows.map((r) => [r.root, r.amount]));
    let tp = 0;
    let ta = 0;
    const items = cats.map((c) => {
      const p = toCents(planned.get(c.id) ?? '0');
      const a = toCents(actual.get(c.id) ?? '0');
      tp += p;
      ta += a;
      return {
        categoryId: c.id, name: c.name, color: c.color, planned: fromCents(p), actual: fromCents(a), remaining: fromCents(p - a),
        usedPct: p > 0 ? Math.round((a * 1000) / p) / 10 : null,
      };
    });
    return { month, totals: { planned: fromCents(tp), actual: fromCents(ta), remaining: fromCents(tp - ta) }, items };
  }
}
