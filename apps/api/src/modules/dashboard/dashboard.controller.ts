import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { sql } from 'kysely';
import { Family, type FamilyContext } from '../../common/context';
import { DATE_MSG, DATE_RE } from '../../common/dto';
import { addDays, addMonths, bool, fromCents, monthEnd, monthOf, monthStart, today, toCents } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import { AccountsService } from '../accounts/accounts.service';
import { BudgetsService } from '../budgets/budgets.service';
import { LimitsService } from '../limits/limits.service';
import { applyTxFilter, type TxFilter } from './tx-filter';

class DashboardQuery implements TxFilter {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Padrão: início do mês atual' }) @IsOptional() @Matches(DATE_RE, { message: `from ${DATE_MSG}` }) from?: string;
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Padrão: fim do mês atual' }) @IsOptional() @Matches(DATE_RE, { message: `to ${DATE_MSG}` }) to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() memberId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
  @ApiPropertyOptional({ default: 12, description: 'Meses na série temporal' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36) months?: number;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : 0);

@ApiTags('Dashboards')
@ApiBearerAuth()
@Controller('families/:familyId/dashboard')
export class DashboardController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly vis: VisibilityService,
    private readonly accounts: AccountsService,
    private readonly limits: LimitsService,
    private readonly budgets: BudgetsService,
  ) {}

  private range(q: DashboardQuery) {
    const t = today();
    return { ...q, from: q.from ?? monthStart(t), to: q.to ?? monthEnd(t) };
  }

  private base() {
    return this.db.selectFrom('transactions as t').innerJoin('categories as c', 'c.id', 't.category_id');
  }

  @Get('summary')
  @ApiOperation({ summary: 'Receitas, despesas, resultado, saldo das contas e faturas em aberto' })
  async summary(@Family() ctx: FamilyContext, @Query() query: DashboardQuery) {
    const f = this.range(query);
    const q = await applyTxFilter(this.base(), ctx, f, this.vis);
    const sums = q
      ? await q
          .select([
            sql<string>`COALESCE(SUM(CASE WHEN t.type = 'INCOME' THEN t.amount ELSE 0 END), 0)`.as('income'),
            sql<string>`COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE 0 END), 0)`.as('expense'),
            sql<number>`COUNT(*)`.as('count'),
          ])
          .executeTakeFirstOrThrow()
      : { income: '0', expense: '0', count: 0 };

    const visibleAccs = await this.vis.visibleAccountIds(ctx);
    let accQ = this.db.selectFrom('accounts').select('id').where('family_id', '=', ctx.familyId).where('deleted_at', 'is', null);
    if (visibleAccs) accQ = visibleAccs.length ? accQ.where('id', 'in', visibleAccs) : accQ.where(sql<boolean>`FALSE`);
    if (f.accountId) accQ = accQ.where('id', '=', f.accountId);
    const accIds = (await accQ.execute()).map((a) => a.id);
    const balances = await this.accounts.balances(ctx.familyId, accIds, f.to);
    const balance = [...balances.values()].reduce((s, v) => s + toCents(v), 0);

    const visibleCards = await this.vis.visibleCardIds(ctx);
    let stQ = this.db
      .selectFrom('card_statements as s')
      .innerJoin('credit_cards as k', 'k.id', 's.card_id')
      .select(sql<string>`COALESCE(SUM(GREATEST(s.total_amount - s.paid_amount, 0)), 0)`.as('open'))
      .where('s.family_id', '=', ctx.familyId)
      .where('k.deleted_at', 'is', null)
      .where('s.status', '<>', 'PAID');
    if (visibleCards) stQ = visibleCards.length ? stQ.where('s.card_id', 'in', visibleCards) : stQ.where(sql<boolean>`FALSE`);
    if (f.cardId) stQ = stQ.where('s.card_id', '=', f.cardId);
    const open = (await stQ.executeTakeFirstOrThrow()).open;

    const inc = toCents(sums.income);
    const exp = toCents(sums.expense);
    return {
      period: { from: f.from, to: f.to },
      income: fromCents(inc),
      expense: fromCents(exp),
      result: fromCents(inc - exp),
      accountsBalance: fromCents(balance),
      openCardBills: open,
      transactionCount: Number(sums.count),
    };
  }

  @Get('by-category')
  @ApiOperation({ summary: 'Despesas por categoria (subcategorias somadas na categoria pai)' })
  async byCategory(@Family() ctx: FamilyContext, @Query() query: DashboardQuery) {
    const f = this.range(query);
    const q = await applyTxFilter(this.base(), ctx, f, this.vis);
    if (!q) return { period: { from: f.from, to: f.to }, total: '0.00', items: [] };
    const rows = await q
      .innerJoin('categories as p', (j) => j.on(sql`p.id = COALESCE(c.parent_id, c.id)`))
      .select(['p.id', 'p.name', 'p.color', sql<string>`SUM(t.amount)`.as('amount')])
      .where('t.type', '=', 'EXPENSE')
      .groupBy(['p.id', 'p.name', 'p.color'])
      .orderBy(sql`SUM(t.amount)`, 'desc')
      .execute();
    const total = rows.reduce((s, r) => s + toCents(r.amount), 0);
    return {
      period: { from: f.from, to: f.to },
      total: fromCents(total),
      items: rows.map((r) => ({ categoryId: r.id, name: r.name, color: r.color, amount: fromCents(toCents(r.amount)), pct: pct(toCents(r.amount), total) })),
    };
  }

  @Get('by-member')
  @ApiOperation({ summary: 'Despesas e receitas por membro' })
  async byMember(@Family() ctx: FamilyContext, @Query() query: DashboardQuery) {
    const f = this.range(query);
    const q = await applyTxFilter(this.base(), ctx, f, this.vis);
    if (!q) return { period: { from: f.from, to: f.to }, items: [] };
    const rows = await q
      .leftJoin('users as u', 'u.id', 't.member_user_id')
      .select([
        't.member_user_id as userId',
        'u.name',
        sql<string>`COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE 0 END), 0)`.as('expense'),
        sql<string>`COALESCE(SUM(CASE WHEN t.type = 'INCOME' THEN t.amount ELSE 0 END), 0)`.as('income'),
      ])
      .where('t.type', 'in', ['EXPENSE', 'INCOME'])
      .groupBy(['t.member_user_id', 'u.name'])
      .orderBy(sql`SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE 0 END)`, 'desc')
      .execute();
    return { period: { from: f.from, to: f.to }, items: rows.map((r) => ({ userId: r.userId, name: r.name ?? 'Sem membro', expense: r.expense, income: r.income })) };
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Evolução mensal de receitas e despesas (termina no mês de `to`)' })
  async timeseries(@Family() ctx: FamilyContext, @Query() query: DashboardQuery) {
    const months = query.months ?? 12;
    const end = monthEnd(query.to ?? today());
    const start = monthStart(addMonths(monthStart(end), -(months - 1)));
    const q = await applyTxFilter(this.base(), ctx, { ...query, from: start, to: end }, this.vis);
    const rows = q
      ? await q
          .select([
            sql<string>`DATE_FORMAT(t.occurred_on, '%Y-%m')`.as('month'),
            sql<string>`COALESCE(SUM(CASE WHEN t.type = 'INCOME' THEN t.amount ELSE 0 END), 0)`.as('income'),
            sql<string>`COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE 0 END), 0)`.as('expense'),
          ])
          .groupBy(sql`DATE_FORMAT(t.occurred_on, '%Y-%m')`)
          .execute()
      : [];
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const series = Array.from({ length: months }, (_, i) => {
      const m = monthOf(addMonths(start, i));
      const r = byMonth.get(m);
      const inc = toCents(r?.income ?? '0');
      const exp = toCents(r?.expense ?? '0');
      return { month: m, income: fromCents(inc), expense: fromCents(exp), result: fromCents(inc - exp) };
    });
    return { from: start, to: end, series };
  }

  @Get('limits-vs-actual')
  @ApiOperation({ summary: 'Limites ativos com consumo do período atual' })
  async limitsVsActual(@Family() ctx: FamilyContext) {
    const rows = await this.db.selectFrom('spending_limits').selectAll().where('family_id', '=', ctx.familyId).where('is_active', '=', 1).orderBy('name').execute();
    const items = [];
    for (const l of rows) {
      const s = await this.limits.snapshot(l);
      items.push({ id: l.id, name: l.name, scopeType: l.scope_type, period: l.period, amount: l.amount, thresholds: l.thresholds, currentPeriod: s.period, consumed: s.consumed, consumedPct: s.consumedPct, status: s.status, isActive: bool(l.is_active) });
    }
    return { items };
  }

  @Get('budgets-vs-actual')
  @ApiOperation({ summary: 'Orçado × realizado por categoria no mês de `to`' })
  budgetsVsActual(@Family() ctx: FamilyContext, @Query() query: DashboardQuery) {
    return this.budgets.monthView(ctx, monthOf(query.to ?? today()));
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Faturas a vencer nos próximos 45 dias' })
  async upcoming(@Family() ctx: FamilyContext) {
    const t = today();
    const visibleCards = await this.vis.visibleCardIds(ctx);
    if (visibleCards && !visibleCards.length) return { items: [] };
    let q = this.db
      .selectFrom('card_statements as s')
      .innerJoin('credit_cards as k', 'k.id', 's.card_id')
      .select(['s.id', 's.card_id as cardId', 'k.name as cardName', 's.reference_month as referenceMonth', 's.due_date as dueDate', 's.total_amount as totalAmount', 's.paid_amount as paidAmount', 's.status'])
      .where('s.family_id', '=', ctx.familyId)
      .where('k.deleted_at', 'is', null)
      .where('s.status', '<>', 'PAID')
      .where('s.total_amount', '>', '0')
      .where('s.due_date', '<=', addDays(t, 45));
    if (visibleCards) q = q.where('s.card_id', 'in', visibleCards);
    const items = await q.orderBy('s.due_date').execute();
    return { items: items.map((i) => ({ ...i, overdue: i.dueDate < t })) };
  }
}
