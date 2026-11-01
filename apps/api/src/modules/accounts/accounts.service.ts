import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { fromCents, toCents } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';

/** Saldo = saldo inicial + entradas − saídas até a data (lançamentos não excluídos). */
@Injectable()
export class AccountsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async balances(familyId: string, accountIds: string[], at?: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!accountIds.length) return out;
    const accs = await this.db.selectFrom('accounts').select(['id', 'opening_balance']).where('family_id', '=', familyId).where('id', 'in', accountIds).execute();
    let q = this.db
      .selectFrom('transactions')
      .select([
        'account_id',
        sql<string>`COALESCE(SUM(CASE WHEN type IN ('INCOME','TRANSFER_IN') THEN amount ELSE -amount END), 0)`.as('delta'),
      ])
      .where('family_id', '=', familyId)
      .where('account_id', 'in', accountIds)
      .where('deleted_at', 'is', null)
      .groupBy('account_id');
    if (at) q = q.where('occurred_on', '<=', at);
    const deltas = new Map((await q.execute()).map((r) => [r.account_id!, r.delta]));
    for (const a of accs) out.set(a.id, fromCents(toCents(a.opening_balance) + toCents(deltas.get(a.id) ?? '0')));
    return out;
  }
}
