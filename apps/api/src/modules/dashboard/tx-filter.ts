import type { ExpressionBuilder, SelectQueryBuilder } from 'kysely';
import type { FamilyContext } from '../../common/context';
import type { VisibilityService } from '../../common/visibility.service';
import type { Database } from '../../db/types';

export interface TxFilter {
  from?: string;
  to?: string;
  categoryId?: string;
  memberId?: string;
  accountId?: string;
  cardId?: string;
}

type DB = Database & { t: Database['transactions']; c: Database['categories'] };

/**
 * Aplica família, exclusão lógica, visibilidade (contas/cartões restritos) e filtros comuns
 * a uma query sobre `transactions as t` com `categories as c` já unida.
 * Retorna null quando o usuário não enxerga nenhuma conta nem cartão.
 */
export async function applyTxFilter<O>(
  q: SelectQueryBuilder<DB, 't' | 'c', O>,
  ctx: FamilyContext,
  f: TxFilter,
  vis: VisibilityService,
): Promise<SelectQueryBuilder<DB, 't' | 'c', O> | null> {
  let query = q.where('t.family_id', '=', ctx.familyId).where('t.deleted_at', 'is', null);
  const accs = await vis.visibleAccountIds(ctx);
  const cards = await vis.visibleCardIds(ctx);
  if (accs || cards) {
    if (!accs?.length && !cards?.length) return null;
    query = query.where((eb: ExpressionBuilder<DB, 't' | 'c'>) =>
      eb.or([...(accs?.length ? [eb('t.account_id', 'in', accs)] : []), ...(cards?.length ? [eb('t.card_id', 'in', cards)] : [])]),
    );
  }
  if (f.from) query = query.where('t.occurred_on', '>=', f.from);
  if (f.to) query = query.where('t.occurred_on', '<=', f.to);
  if (f.categoryId) query = query.where((eb: ExpressionBuilder<DB, 't' | 'c'>) => eb.or([eb('t.category_id', '=', f.categoryId!), eb('c.parent_id', '=', f.categoryId!)]));
  if (f.memberId) query = query.where('t.member_user_id', '=', f.memberId);
  if (f.accountId) query = query.where('t.account_id', '=', f.accountId);
  if (f.cardId) query = query.where('t.card_id', '=', f.cardId);
  return query;
}
