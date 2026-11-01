import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { config } from '../../config';
import type { FamilyContext, RequestMeta } from '../../common/context';
import { addDays, addMonths, today } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';
import type { Role } from '../../db/types';
import { TransactionsService, type TxInput } from '../transactions/transactions.service';

export interface RecurrenceTemplate {
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  description: string;
  categoryId: string;
  accountId: string | null;
  cardId: string | null;
  memberUserId: string | null;
}

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
const MAX_PER_RUN = 36; // evita gerar anos de uma vez se uma regra antiga for retomada

export function nextOccurrence(date: string, freq: Freq, interval: number, dayOfMonth: number | null): string {
  switch (freq) {
    case 'DAILY':
      return addDays(date, interval);
    case 'WEEKLY':
      return addDays(date, 7 * interval);
    case 'MONTHLY':
      return addMonths(date, interval, dayOfMonth ?? undefined);
    case 'YEARLY':
      return addMonths(date, 12 * interval, dayOfMonth ?? undefined);
  }
}

/**
 * Gera os lançamentos das regras recorrentes até hoje. Idempotente: a chave única
 * (recurrence_rule_id, occurred_on) impede duplicar e uma ocorrência excluída não volta.
 * Roda ao subir a API e a cada hora (em produção iria para uma fila agendada).
 */
@Injectable()
export class RecurrencesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Recurrences');
  private timer?: NodeJS.Timeout;

  constructor(@InjectDb() private readonly db: Db, private readonly txs: TransactionsService) {}

  onApplicationBootstrap() {
    if (config.isTest) return;
    const tick = () => this.runDue().catch((e) => this.logger.error({ err: e }, 'Falha ao gerar recorrências'));
    setTimeout(tick, 5_000).unref();
    this.timer = setInterval(tick, 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runDue(familyId?: string, until = today()) {
    let q = this.db.selectFrom('recurrence_rules').selectAll().where('is_active', '=', 1).where('next_run_date', '<=', until);
    if (familyId) q = q.where('family_id', '=', familyId);
    let created = 0;
    for (const rule of await q.execute()) created += await this.runRule(rule.id, until);
    if (created) this.logger.log(`${created} lançamento(s) recorrente(s) gerado(s)`);
    return created;
  }

  async runRule(ruleId: string, until = today()): Promise<number> {
    const rule = await this.db.selectFrom('recurrence_rules').selectAll().where('id', '=', ruleId).executeTakeFirst();
    if (!rule || !rule.is_active) return 0;
    // Gera em nome de quem criou a regra, com o papel atual dessa pessoa
    const member = await this.db.selectFrom('family_members').select('role').where('family_id', '=', rule.family_id).where('user_id', '=', rule.created_by).where('status', '=', 'ACTIVE').executeTakeFirst();
    if (!member || member.role === 'VIEWER') {
      await this.db.updateTable('recurrence_rules').set({ is_active: false }).where('id', '=', rule.id).execute();
      this.logger.warn(`Regra ${rule.id} desativada: quem a criou não pode mais lançar`);
      return 0;
    }
    const ctx: FamilyContext = { familyId: rule.family_id, userId: rule.created_by, role: member.role as Role };
    const t = rule.template as unknown as RecurrenceTemplate;
    const dates: string[] = [];
    let next = rule.next_run_date;
    while (next <= until && (!rule.end_date || next <= rule.end_date) && dates.length < MAX_PER_RUN) {
      dates.push(next);
      next = nextOccurrence(next, rule.frequency, rule.interval_n, rule.day_of_month);
    }
    const existing = new Set(
      dates.length
        ? (await this.db.selectFrom('transactions').select('occurred_on').where('recurrence_rule_id', '=', rule.id).where('occurred_on', 'in', dates).execute()).map((r) => r.occurred_on)
        : [],
    );
    const inputs: TxInput[] = dates
      .filter((d) => !existing.has(d))
      .map((d) => ({ type: t.type, amount: t.amount, description: t.description, categoryId: t.categoryId, accountId: t.accountId, cardId: t.cardId, memberUserId: t.memberUserId, occurredOn: d, source: 'RECURRENCE', recurrenceRuleId: rule.id }));
    const meta: RequestMeta = { ip: null, userAgent: 'recurrence-job', requestId: null };
    let created = 0;
    try {
      if (inputs.length) created = (await this.txs.insertMany(ctx, inputs, meta, { action: 'recurrence.generate', entityType: 'recurrence', entityId: rule.id })).ids.length;
    } catch (e) {
      // Categoria desativada, conta excluída etc.: pausa a regra em vez de falhar toda hora
      this.logger.warn(`Regra ${rule.id} pausada: ${(e as Error).message}`);
      await this.db.updateTable('recurrence_rules').set({ is_active: false }).where('id', '=', rule.id).execute();
      return 0;
    }
    const finished = !!rule.end_date && next > rule.end_date;
    await this.db.updateTable('recurrence_rules').set({ next_run_date: next, ...(finished ? { is_active: false } : {}) }).where('id', '=', rule.id).execute();
    return created;
  }
}
