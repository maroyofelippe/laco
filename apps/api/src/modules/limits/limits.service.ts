import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { atLeast } from '../../common/context';
import { addDays, addMonths, dateInMonth, fromCents, monthEnd, monthOf, monthStart, newId, today, toCents, weekStart } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import type { Role, SpendingLimit } from '../../db/types';
import { BillingCycleService } from '../cards/billing-cycle.service';
import { PushService } from './push.service';

export const HYSTERESIS_PCT = 5;

export interface Period {
  start: string;
  end: string;
}

export interface TxChange {
  type: string;
  occurred_on: string;
  category_id: string;
  account_id: string | null;
  card_id: string | null;
  member_user_id: string | null;
}

@Injectable()
export class LimitsService {
  private readonly logger = new Logger('Limits');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly billing: BillingCycleService,
    private readonly push: PushService,
    private readonly vis: VisibilityService,
  ) {}

  // ------------------------------------------------------------- Período
  async periodFor(limit: SpendingLimit, date: string): Promise<Period | null> {
    switch (limit.period) {
      case 'MONTHLY':
        return { start: monthStart(date), end: monthEnd(date) };
      case 'WEEKLY': {
        const s = weekStart(date);
        return { start: s, end: addDays(s, 6) };
      }
      case 'CUSTOM':
        if (date < limit.custom_start! || date > limit.custom_end!) return null;
        return { start: limit.custom_start!, end: limit.custom_end! };
      case 'CARD_CYCLE': {
        const card = await this.db.selectFrom('credit_cards').select(['closing_day', 'due_day']).where('id', '=', limit.scope_id!).executeTakeFirst();
        if (!card) return null;
        const { closingDate } = this.billing.datesFor(card, date);
        const prevClosing = dateInMonth(monthOf(addMonths(`${monthOf(closingDate)}-01`, -1)), card.closing_day);
        return { start: prevClosing, end: addDays(closingDate, -1) };
      }
    }
  }

  // ------------------------------------------------------------- Consumo
  async categoryScope(limit: SpendingLimit): Promise<string[]> {
    if (!limit.include_subcategories) return [limit.scope_id!];
    const children = await this.db.selectFrom('categories').select('id').where('family_id', '=', limit.family_id).where('parent_id', '=', limit.scope_id!).execute();
    return [limit.scope_id!, ...children.map((c) => c.id)];
  }

  /** Soma das despesas no escopo e período. Transferências e pagamento de fatura ficam fora (só type EXPENSE). */
  async consumption(limit: SpendingLimit, p: Period, trx: Db = this.db): Promise<string> {
    let q = trx
      .selectFrom('transactions')
      .select(sql<string>`COALESCE(SUM(amount), 0)`.as('total'))
      .where('family_id', '=', limit.family_id)
      .where('type', '=', 'EXPENSE')
      .where('deleted_at', 'is', null)
      .where('occurred_on', '>=', p.start)
      .where('occurred_on', '<=', p.end);
    switch (limit.scope_type) {
      case 'CATEGORY':
        q = q.where('category_id', 'in', await this.categoryScope(limit));
        break;
      case 'ACCOUNT':
        q = q.where('account_id', '=', limit.scope_id!);
        break;
      case 'CARD':
        q = q.where('card_id', '=', limit.scope_id!);
        break;
      case 'MEMBER':
        q = q.where('member_user_id', '=', limit.scope_id!);
        break;
    }
    return (await q.executeTakeFirstOrThrow()).total;
  }

  async snapshot(limit: SpendingLimit, date = today()) {
    const period = await this.periodFor(limit, date);
    if (!period) return { period: null, consumed: '0.00', consumedPct: 0, status: 'INACTIVE_PERIOD' as const };
    const consumed = await this.consumption(limit, period);
    const pct = pctOf(consumed, limit.amount);
    const minTh = Math.min(...limit.thresholds);
    const status = pct >= 100 ? 'EXCEEDED' : pct >= minTh ? 'WARNING' : 'OK';
    return { period, consumed, consumedPct: pct, status } as const;
  }

  // ------------------------------------------------------------ Avaliação
  /** Chamado depois de criar/editar/excluir lançamentos (já commitados). Devolve alertas novos. */
  async evaluateAfterChange(familyId: string, changes: TxChange[]) {
    const expenses = changes.filter((c) => c.type === 'EXPENSE');
    if (!expenses.length) return [];
    const limits = await this.db.selectFrom('spending_limits').selectAll().where('family_id', '=', familyId).where('is_active', '=', 1).execute();
    const jobs = new Map<string, { limit: SpendingLimit; date: string }>();
    for (const limit of limits) {
      const cats = limit.scope_type === 'CATEGORY' ? await this.categoryScope(limit) : [];
      for (const c of expenses) {
        const hit =
          limit.scope_type === 'FAMILY' ||
          (limit.scope_type === 'CATEGORY' && cats.includes(c.category_id)) ||
          (limit.scope_type === 'ACCOUNT' && c.account_id === limit.scope_id) ||
          (limit.scope_type === 'CARD' && c.card_id === limit.scope_id) ||
          (limit.scope_type === 'MEMBER' && c.member_user_id === limit.scope_id);
        if (!hit) continue;
        const p = await this.periodFor(limit, c.occurred_on);
        if (p) jobs.set(`${limit.id}:${p.start}`, { limit, date: c.occurred_on }); // uma avaliação por limite+período
      }
    }
    const created = [];
    for (const { limit, date } of jobs.values()) created.push(...(await this.evaluate(limit, date)));
    return created;
  }

  async reevaluateAll(familyId: string) {
    const limits = await this.db.selectFrom('spending_limits').selectAll().where('family_id', '=', familyId).where('is_active', '=', 1).execute();
    const out = [];
    for (const l of limits) out.push(...(await this.evaluate(l, today())));
    return out;
  }

  /**
   * Regras: 1 alerta por (limite, período, faixa) — chave única no banco.
   * Consumo abaixo de (faixa − 5 p.p.) resolve o alerta; voltar a cruzar depois disso reativa
   * com novo seq (aparece de novo para o app). Só o alerta mais grave de cada avaliação vira push.
   */
  async evaluate(limit: SpendingLimit, date: string) {
    const period = await this.periodFor(limit, date);
    if (!period) return [];
    const fresh: { id: string; seq: string; threshold: number }[] = [];

    await this.db.transaction().execute(async (trx) => {
      // Serializa avaliações concorrentes do mesmo limite
      await trx.selectFrom('spending_limits').select('id').where('id', '=', limit.id).forUpdate().executeTakeFirst();
      const consumed = await this.consumption(limit, period, trx);
      const pct = pctOf(consumed, limit.amount);
      const existing = await trx.selectFrom('alerts').selectAll().where('limit_id', '=', limit.id).where('period_start', '=', period.start).execute();
      const byTh = new Map(existing.map((a) => [a.threshold_pct, a]));

      for (const th of [...limit.thresholds].sort((a, b) => a - b)) {
        const a = byTh.get(th);
        if (pct >= th) {
          if (!a) {
            const id = newId();
            const seq = await this.nextSeq(trx);
            await trx
              .insertInto('alerts')
              .values({ id, family_id: limit.family_id, limit_id: limit.id, period_start: period.start, period_end: period.end, threshold_pct: th, level: th >= 100 ? 'EXCEEDED' : 'WARNING', consumed_amount: consumed, limit_amount: limit.amount, seq })
              .execute();
            fresh.push({ id, seq: String(seq), threshold: th });
          } else if (a.status === 'RESOLVED') {
            const seq = await this.nextSeq(trx);
            await trx.updateTable('alerts').set({ status: 'ACTIVE', resolved_at: null, consumed_amount: consumed, seq }).where('id', '=', a.id).execute();
            await trx.updateTable('alert_receipts').set({ read_at: null, delivered_at: null }).where('alert_id', '=', a.id).execute();
            fresh.push({ id: a.id, seq: String(seq), threshold: th });
          }
        } else if (a && a.status === 'ACTIVE' && pct < th - HYSTERESIS_PCT) {
          await trx.updateTable('alerts').set({ status: 'RESOLVED', resolved_at: sql`NOW(3)` as never }).where('id', '=', a.id).execute();
        }
      }

      if (fresh.length) {
        const recipients = await this.recipients(limit, trx);
        for (const f of fresh) {
          if (recipients.length) {
            await trx.insertInto('alert_receipts').ignore().values(recipients.map((u) => ({ alert_id: f.id, user_id: u }))).execute();
          }
        }
      }
    });

    if (!fresh.length) return [];
    const top = fresh.reduce((m, f) => (f.threshold > m.threshold ? f : m));
    const recipients = (await this.db.selectFrom('alert_receipts').select('user_id').where('alert_id', '=', top.id).execute()).map((r) => r.user_id);
    await this.push.notifyAlert({ id: top.id, family_id: limit.family_id, limit_id: limit.id, seq: top.seq }, recipients);
    this.logger.log(`Limite "${limit.name}": ${fresh.length} alerta(s) novo(s)`);
    return fresh.map((f) => f.id);
  }

  private async nextSeq(trx: Db): Promise<number> {
    await sql`UPDATE sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = 'alert_seq'`.execute(trx);
    const r = await sql<{ v: string }>`SELECT LAST_INSERT_ID() AS v`.execute(trx);
    return Number(r.rows[0].v);
  }

  /** Membros ativos com papel em notify_roles que enxergam o escopo do limite. */
  private async recipients(limit: SpendingLimit, trx: Db): Promise<string[]> {
    const members = await trx.selectFrom('family_members').select(['user_id', 'role']).where('family_id', '=', limit.family_id).where('status', '=', 'ACTIVE').execute();
    const roles = new Set<Role>(limit.notify_roles);
    const out: string[] = [];
    for (const m of members) {
      const isScopeMember = limit.scope_type === 'MEMBER' && limit.scope_id === m.user_id;
      if (!roles.has(m.role) && !isScopeMember) continue;
      const ctx = { familyId: limit.family_id, userId: m.user_id, role: m.role };
      if (limit.scope_type === 'ACCOUNT' && !atLeast(m.role, 'ADMIN')) {
        const ids = await this.vis.visibleAccountIds(ctx);
        if (ids && !ids.includes(limit.scope_id!)) continue;
      }
      if ((limit.scope_type === 'CARD') && !atLeast(m.role, 'ADMIN')) {
        const ids = await this.vis.visibleCardIds(ctx);
        if (ids && !ids.includes(limit.scope_id!)) continue;
      }
      out.push(m.user_id);
    }
    return out;
  }
}

export function pctOf(consumed: string, amount: string): number {
  const a = toCents(amount);
  return a > 0 ? Math.floor((toCents(consumed) * 100) / a) : 0;
}

export { fromCents };
