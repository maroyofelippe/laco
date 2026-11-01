import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit.service';
import { atLeast, type FamilyContext, type RequestMeta } from '../../common/context';
import { Errors } from '../../common/errors';
import { addMonths, bool, decodeCursor, encodeCursor, newId, normalizeDescription, sha256, splitInstallments, toCents } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import type { NewTransaction, Transaction } from '../../db/types';
import { BillingCycleService } from '../cards/billing-cycle.service';
import { LimitsService, type TxChange } from '../limits/limits.service';
import type { CreateInstallmentsDto, CreateTransactionDto, CreateTransferDto, ListTransactionsQuery, UpdateTransactionDto } from './transactions.dto';

export interface TxInput {
  id?: string;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  description: string;
  categoryId: string;
  accountId?: string | null;
  cardId?: string | null;
  memberUserId?: string | null;
  occurredOn: string;
  status?: 'PENDING' | 'CLEARED';
  notes?: string | null;
  source: 'MANUAL' | 'PDF_IMPORT' | 'RECEIPT_OCR' | 'RECURRENCE';
  importItemId?: string;
  recurrenceRuleId?: string;
}

/** Impressão digital usada para detectar duplicatas (manual, PDF, OCR). */
export const fingerprint = (t: { family_id: string; account_id: string | null; card_id: string | null; occurred_on: string; amount: string | number; normalized_description: string; installment_number?: number | null }) =>
  sha256([t.family_id, t.account_id ?? t.card_id, t.occurred_on, String(t.amount), t.normalized_description, t.installment_number ?? ''].join('|'));

@Injectable()
export class TransactionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly vis: VisibilityService,
    private readonly billing: BillingCycleService,
    private readonly limits: LimitsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- Listagem
  async list(ctx: FamilyContext, q: ListTransactionsQuery) {
    const limit = q.limit ?? 50;
    const base = await this.filtered(ctx, q);
    if (!base) return { data: [], totals: { income: '0.00', expense: '0.00' }, nextCursor: null };

    const totals = await base
      .clearSelect()
      .select([
        sql<string>`COALESCE(SUM(CASE WHEN t.type = 'INCOME' THEN t.amount ELSE 0 END), 0)`.as('income'),
        sql<string>`COALESCE(SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE 0 END), 0)`.as('expense'),
      ])
      .executeTakeFirstOrThrow();

    let page = base;
    const cur = decodeCursor<{ d: string; i: string }>(q.cursor);
    if (cur) page = page.where((eb) => eb.or([eb('t.occurred_on', '<', cur.d), eb.and([eb('t.occurred_on', '=', cur.d), eb('t.id', '<', cur.i)])]));
    const rows = await page.orderBy('t.occurred_on', 'desc').orderBy('t.id', 'desc').limit(limit + 1).execute();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      data: items.map(toDto),
      totals: { income: totals.income, expense: totals.expense },
      nextCursor: hasMore && last ? encodeCursor({ d: last.occurred_on, i: last.id }) : null,
    };
  }

  /** Query base com joins, filtros e visibilidade. null = usuário não enxerga nenhuma conta/cartão. */
  private async filtered(ctx: FamilyContext, q: Partial<ListTransactionsQuery>) {
    let query = this.joined().where('t.family_id', '=', ctx.familyId).where('t.deleted_at', 'is', null);
    const accs = await this.vis.visibleAccountIds(ctx);
    const cards = await this.vis.visibleCardIds(ctx);
    if (accs || cards) {
      if (!accs?.length && !cards?.length) return null;
      query = query.where((eb) =>
        eb.or([
          ...(accs?.length ? [eb('t.account_id', 'in', accs)] : []),
          ...(cards?.length ? [eb('t.card_id', 'in', cards)] : []),
        ]),
      );
    }
    if (q.from) query = query.where('t.occurred_on', '>=', q.from);
    if (q.to) query = query.where('t.occurred_on', '<=', q.to);
    if (q.type) query = query.where('t.type', '=', q.type as Transaction['type']);
    if (q.categoryId) query = query.where((eb) => eb.or([eb('t.category_id', '=', q.categoryId!), eb('c.parent_id', '=', q.categoryId!)]));
    if (q.accountId) query = query.where('t.account_id', '=', q.accountId);
    if (q.cardId) query = query.where('t.card_id', '=', q.cardId);
    if (q.memberId) query = query.where('t.member_user_id', '=', q.memberId);
    if (q.source) query = query.where('t.source', '=', q.source as Transaction['source']);
    if (q.q) {
      const term = normalizeDescription(q.q);
      if (term) query = query.where('t.normalized_description', 'like', `%${term.replace(/[%_]/g, '')}%`);
    }
    return query;
  }

  private joined() {
    return this.db
      .selectFrom('transactions as t')
      .innerJoin('categories as c', 'c.id', 't.category_id')
      .leftJoin('accounts as a', 'a.id', 't.account_id')
      .leftJoin('credit_cards as k', 'k.id', 't.card_id')
      .leftJoin('users as u', 'u.id', 't.member_user_id')
      .leftJoin('card_statements as s', 's.id', 't.statement_id')
      .selectAll('t')
      .select(['c.name as category_name', 'c.color as category_color', 'c.parent_id as category_parent_id', 'a.name as account_name', 'k.name as card_name', 'u.name as member_name', 's.reference_month as statement_month', 's.due_date as statement_due'])
      .$castTo<JoinedRow>();
  }

  async get(ctx: FamilyContext, id: string) {
    const row = await this.joined().where('t.family_id', '=', ctx.familyId).where('t.id', '=', id).where('t.deleted_at', 'is', null).executeTakeFirst();
    if (!row) throw Errors.notFound('Lançamento');
    await this.assertVisible(ctx, row);
    return toDto(row);
  }

  // ---------------------------------------------------------------- Criação
  async create(ctx: FamilyContext, dto: CreateTransactionDto, meta: RequestMeta) {
    const means = await this.resolveMeans(ctx, dto.accountId, dto.cardId);
    await this.assertCategory(ctx, dto.categoryId, dto.type);
    const memberId = await this.resolveMember(ctx, dto.memberUserId);
    const id = dto.id ?? newId();
    const normalized = normalizeDescription(dto.description);
    const row: NewTransaction = {
      id, family_id: ctx.familyId, type: dto.type, amount: dto.amount, description: dto.description.trim(), normalized_description: normalized,
      category_id: dto.categoryId, account_id: means.accountId, card_id: means.cardId, statement_id: null, member_user_id: memberId,
      occurred_on: dto.occurredOn, status: dto.status ?? 'CLEARED', source: dto.source ?? 'MANUAL', notes: dto.notes ?? null, created_by: ctx.userId,
      fingerprint: '',
    };
    row.fingerprint = fingerprint({ ...row, amount: dto.amount, account_id: means.accountId, card_id: means.cardId, normalized_description: normalized });
    const duplicate = await this.findDuplicate(ctx.familyId, row.fingerprint);

    await this.db.transaction().execute(async (trx) => {
      if (means.card) row.statement_id = await this.billing.getOrCreate(trx, means.card, dto.occurredOn);
      await trx.insertInto('transactions').values(row).execute();
      await this.billing.recalc(trx, ctx.familyId, row.statement_id);
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'transaction.create', entityType: 'transaction', entityId: id, diff: dto, meta }, trx);
    });
    const alerts = await this.limits.evaluateAfterChange(ctx.familyId, [toChange(row)]);
    return { ...(await this.get(ctx, id)), possibleDuplicateOf: duplicate, alertsTriggered: await this.alertSummaries(alerts) };
  }

  async createInstallments(ctx: FamilyContext, dto: CreateInstallmentsDto, meta: RequestMeta) {
    const means = await this.resolveMeans(ctx, dto.accountId, dto.cardId);
    await this.assertCategory(ctx, dto.categoryId, 'EXPENSE');
    const memberId = await this.resolveMember(ctx, dto.memberUserId);
    const planId = dto.id ?? newId();
    const amounts = splitInstallments(dto.totalAmount, dto.installments);
    const rows: NewTransaction[] = [];

    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('installment_plans').values({ id: planId, family_id: ctx.familyId, total_amount: dto.totalAmount, installments_count: dto.installments, first_date: dto.firstDate, description: dto.description.trim() }).execute();
      for (let i = 0; i < dto.installments; i++) {
        // Cada parcela "ocorre" no mês em que é cobrada: cai na fatura certa e conta no limite daquele mês
        const occurredOn = addMonths(dto.firstDate, i);
        const description = `${dto.description.trim()} ${i + 1}/${dto.installments}`;
        const normalized = normalizeDescription(dto.description);
        const r: NewTransaction = {
          id: newId(), family_id: ctx.familyId, type: 'EXPENSE', amount: amounts[i], description, normalized_description: normalized,
          category_id: dto.categoryId, account_id: means.accountId, card_id: means.cardId, member_user_id: memberId, occurred_on: occurredOn,
          installment_plan_id: planId, installment_number: i + 1, created_by: ctx.userId, fingerprint: '',
          statement_id: means.card ? await this.billing.getOrCreate(trx, means.card, occurredOn) : null,
          status: i === 0 ? 'CLEARED' : 'PENDING',
        };
        r.fingerprint = fingerprint({ ...r, amount: amounts[i], account_id: means.accountId, card_id: means.cardId, normalized_description: normalized, installment_number: i + 1 });
        rows.push(r);
      }
      await trx.insertInto('transactions').values(rows).execute();
      for (const sid of new Set(rows.map((r) => r.statement_id))) await this.billing.recalc(trx, ctx.familyId, sid);
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'transaction.installments', entityType: 'installment_plan', entityId: planId, diff: dto, meta }, trx);
    });

    const alerts = await this.limits.evaluateAfterChange(ctx.familyId, rows.map(toChange));
    const created = await this.joined().where('t.family_id', '=', ctx.familyId).where('t.installment_plan_id', '=', planId).orderBy('t.installment_number').execute();
    return { installmentPlanId: planId, transactions: created.map(toDto), alertsTriggered: await this.alertSummaries(alerts) };
  }

  async createTransfer(ctx: FamilyContext, dto: CreateTransferDto, meta: RequestMeta) {
    if (dto.fromAccountId === dto.toAccountId) throw Errors.validation([{ field: 'toAccountId', message: 'deve ser diferente da conta de origem' }]);
    await this.vis.assertAccount(ctx, dto.fromAccountId, true);
    await this.vis.assertAccount(ctx, dto.toAccountId, true);
    const cat = await this.systemCategory(ctx.familyId, 'Transferência');
    const group = newId();
    const description = dto.description?.trim() || 'Transferência entre contas';
    const normalized = normalizeDescription(description);
    const legs: NewTransaction[] = (['TRANSFER_OUT', 'TRANSFER_IN'] as const).map((type) => {
      const accountId = type === 'TRANSFER_OUT' ? dto.fromAccountId : dto.toAccountId;
      const r: NewTransaction = {
        id: newId(), family_id: ctx.familyId, type, amount: dto.amount, description, normalized_description: normalized, category_id: cat,
        account_id: accountId, card_id: null, member_user_id: ctx.userId, occurred_on: dto.occurredOn, transfer_group_id: group, created_by: ctx.userId, fingerprint: '',
      };
      r.fingerprint = sha256(`${fingerprint({ ...r, amount: dto.amount, account_id: accountId, card_id: null, normalized_description: normalized })}|${type}`);
      return r;
    });
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('transactions').values(legs).execute();
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'transaction.transfer', entityType: 'transfer', entityId: group, diff: dto, meta }, trx);
    });
    const created = await this.joined().where('t.family_id', '=', ctx.familyId).where('t.transfer_group_id', '=', group).execute();
    return { transferGroupId: group, transactions: created.map(toDto) };
  }

  // ------------------------------------------------- Inserção em lote (importação, recorrência)
  /**
   * Cria vários lançamentos numa única transação do banco, com as mesmas regras do lançamento
   * manual (categoria ativa e compatível, visibilidade/edição da conta ou cartão, membro ativo,
   * fatura certa, impressão digital). Tudo ou nada; limites são avaliados uma vez ao final.
   */
  async insertMany(
    ctx: FamilyContext,
    inputs: TxInput[],
    meta: RequestMeta,
    opts: { action: string; entityType: string; entityId: string; onInserted?: (trx: Db, rows: NewTransaction[]) => Promise<void> },
  ) {
    const meansCache = new Map<string, Awaited<ReturnType<TransactionsService['resolveMeans']>>>();
    const catCache = new Set<string>();
    const rows: NewTransaction[] = [];
    for (const i of inputs) {
      const key = `${i.accountId ?? ''}|${i.cardId ?? ''}`;
      if (!meansCache.has(key)) meansCache.set(key, await this.resolveMeans(ctx, i.accountId ?? undefined, i.cardId ?? undefined));
      const means = meansCache.get(key)!;
      if (!catCache.has(`${i.categoryId}|${i.type}`)) {
        await this.assertCategory(ctx, i.categoryId, i.type);
        catCache.add(`${i.categoryId}|${i.type}`);
      }
      const memberId = await this.resolveMember(ctx, i.memberUserId ?? undefined);
      const normalized = normalizeDescription(i.description);
      const row: NewTransaction = {
        id: i.id ?? newId(), family_id: ctx.familyId, type: i.type, amount: i.amount, description: i.description.trim().slice(0, 200), normalized_description: normalized,
        category_id: i.categoryId, account_id: means.accountId, card_id: means.cardId, statement_id: null, member_user_id: memberId,
        occurred_on: i.occurredOn, status: i.status ?? 'CLEARED', source: i.source, notes: i.notes ?? null, created_by: ctx.userId,
        import_item_id: i.importItemId ?? null, recurrence_rule_id: i.recurrenceRuleId ?? null, fingerprint: '',
      };
      row.fingerprint = fingerprint({ ...row, amount: i.amount, account_id: means.accountId, card_id: means.cardId, normalized_description: normalized });
      rows.push(row);
    }
    if (!rows.length) return { ids: [] as string[], alerts: [] as string[] };

    await this.db.transaction().execute(async (trx) => {
      for (const r of rows) {
        const means = meansCache.get(`${r.account_id ?? ''}|${r.card_id ?? ''}`);
        if (means?.card) r.statement_id = await this.billing.getOrCreate(trx, means.card, r.occurred_on);
      }
      await trx.insertInto('transactions').values(rows).execute();
      for (const sid of new Set(rows.map((r) => r.statement_id))) await this.billing.recalc(trx, ctx.familyId, sid);
      if (opts.onInserted) await opts.onInserted(trx, rows);
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: opts.action, entityType: opts.entityType, entityId: opts.entityId, diff: { created: rows.length }, meta }, trx);
    });
    const alerts = await this.limits.evaluateAfterChange(ctx.familyId, rows.map(toChange));
    return { ids: rows.map((r) => r.id), alerts };
  }

  /** Página de mudanças para a sincronização do app (inclui excluídos como marcadores). */
  async changesSince(ctx: FamilyContext, since: string | null, limit: number) {
    let q = this.db
      .selectFrom('transactions as t')
      .innerJoin('categories as c', 'c.id', 't.category_id')
      .leftJoin('accounts as a', 'a.id', 't.account_id')
      .leftJoin('credit_cards as k', 'k.id', 't.card_id')
      .leftJoin('users as u', 'u.id', 't.member_user_id')
      .leftJoin('card_statements as s', 's.id', 't.statement_id')
      .selectAll('t')
      .select(['c.name as category_name', 'c.color as category_color', 'c.parent_id as category_parent_id', 'a.name as account_name', 'k.name as card_name', 'u.name as member_name', 's.reference_month as statement_month', 's.due_date as statement_due'])
      .$castTo<JoinedRow>()
      .where('t.family_id', '=', ctx.familyId);
    const accs = await this.vis.visibleAccountIds(ctx);
    const cards = await this.vis.visibleCardIds(ctx);
    if (accs || cards) {
      if (!accs?.length && !cards?.length) return { rows: [], hasMore: false };
      q = q.where((eb) => eb.or([...(accs?.length ? [eb('t.account_id', 'in', accs)] : []), ...(cards?.length ? [eb('t.card_id', 'in', cards)] : [])]));
    }
    if (since) q = q.where('t.updated_at', '>=', since.replace('T', ' ').replace('Z', ''));
    else q = q.where('t.deleted_at', 'is', null);
    const rows = await q.orderBy('t.updated_at').orderBy('t.id').limit(limit + 1).execute();
    return { rows: rows.slice(0, limit).map((r) => ({ ...toDto(r), deleted: r.deleted_at !== null, updatedAtRaw: r.updated_at })), hasMore: rows.length > limit };
  }

  // ---------------------------------------------------------------- Edição
  async update(ctx: FamilyContext, id: string, dto: UpdateTransactionDto, ifMatch: string | undefined, scope: 'this' | 'future' | 'all', meta: RequestMeta) {
    if (!ifMatch) throw Errors.badRequest('PRECONDITION_REQUIRED', 'Envie o header If-Match com a versão do lançamento.');
    const cur = await this.loadEditable(ctx, id);
    if (Number(ifMatch) !== cur.version) throw Errors.conflict('VERSION_CONFLICT', 'O lançamento foi alterado por outra pessoa. Recarregue para ver a versão atual.', { currentVersion: cur.version });
    if (cur.transfer_group_id || cur.type === 'CARD_PAYMENT') {
      const allowed = ['description', 'notes'];
      if (Object.keys(dto).some((k) => !allowed.includes(k))) throw Errors.unprocessable('TRANSFER_IMMUTABLE', 'Em transferências e pagamentos de fatura dá para editar só a descrição e as observações. Para mudar valores, exclua e lance de novo.');
    }
    if (cur.installment_plan_id && scope !== 'this' && (dto.amount || dto.occurredOn || dto.accountId || dto.cardId)) {
      throw Errors.unprocessable('INSTALLMENT_SCOPE', 'Valor, data e meio de pagamento são alterados uma parcela por vez.');
    }

    const type = cur.type as 'INCOME' | 'EXPENSE';
    if (dto.categoryId) await this.assertCategory(ctx, dto.categoryId, cur.transfer_group_id ? 'TRANSFER' : type);
    const meansChanged = dto.accountId !== undefined || dto.cardId !== undefined;
    const means = meansChanged ? await this.resolveMeans(ctx, dto.accountId, dto.cardId) : null;
    const memberId = dto.memberUserId ? await this.resolveMember(ctx, dto.memberUserId) : undefined;

    const targets = await this.scopeTargets(ctx, cur, scope);
    const before = targets.map(toChange);
    const planCount = cur.installment_plan_id
      ? (await this.db.selectFrom('installment_plans').select('installments_count').where('id', '=', cur.installment_plan_id).executeTakeFirstOrThrow()).installments_count
      : null;
    const touchedStatements = new Set<string | null>(targets.map((t) => t.statement_id));

    await this.db.transaction().execute(async (trx) => {
      for (const t of targets) {
        const next = {
          amount: t.id === cur.id && dto.amount ? dto.amount : t.amount,
          description: dto.description ? (t.installment_number && planCount ? `${dto.description.trim()} ${t.installment_number}/${planCount}` : dto.description.trim()) : t.description,
          occurred_on: t.id === cur.id && dto.occurredOn ? dto.occurredOn : t.occurred_on,
          account_id: means ? means.accountId : t.account_id,
          card_id: means ? means.cardId : t.card_id,
        };
        const normalized = normalizeDescription(dto.description ?? t.normalized_description);
        let statementId = t.statement_id;
        const card = means ? means.card : t.card_id ? await this.vis.assertCard(ctx, t.card_id) : null;
        if (card && (means || next.occurred_on !== t.occurred_on)) statementId = await this.billing.getOrCreate(trx, card, next.occurred_on);
        if (!card) statementId = t.type === 'CARD_PAYMENT' ? t.statement_id : null;
        touchedStatements.add(statementId);
        const upd = await trx
          .updateTable('transactions')
          .set((eb) => ({
            amount: next.amount,
            description: next.description,
            normalized_description: normalized,
            occurred_on: next.occurred_on,
            account_id: next.account_id,
            card_id: next.card_id,
            statement_id: statementId,
            ...(dto.categoryId ? { category_id: dto.categoryId } : {}),
            ...(memberId ? { member_user_id: memberId } : {}),
            ...(dto.status && t.id === cur.id ? { status: dto.status } : {}),
            ...(dto.notes !== undefined && t.id === cur.id ? { notes: dto.notes } : {}),
            fingerprint: t.transfer_group_id || t.type === 'CARD_PAYMENT' ? t.fingerprint : fingerprint({ family_id: ctx.familyId, account_id: next.account_id, card_id: next.card_id, occurred_on: next.occurred_on, amount: next.amount, normalized_description: normalized, installment_number: t.installment_number }),
            version: eb('version', '+', 1),
          }))
          .where('family_id', '=', ctx.familyId)
          .where('id', '=', t.id)
          .where('version', '=', t.version)
          .executeTakeFirst();
        if (Number(upd.numUpdatedRows) === 0) throw Errors.conflict('VERSION_CONFLICT', 'Alguém alterou este lançamento enquanto você editava. Recarregue e tente de novo.');
      }
      for (const sid of touchedStatements) await this.billing.recalc(trx, ctx.familyId, sid);
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'transaction.update', entityType: 'transaction', entityId: id, diff: { scope, before: pick(cur), after: dto, affected: targets.length }, meta }, trx);
    });

    const after = await this.db.selectFrom('transactions').selectAll().where('family_id', '=', ctx.familyId).where('id', 'in', targets.map((t) => t.id)).execute();
    const alerts = await this.limits.evaluateAfterChange(ctx.familyId, [...before, ...after.map(toChange)]);
    return { ...(await this.get(ctx, id)), affected: targets.length, alertsTriggered: await this.alertSummaries(alerts) };
  }

  async remove(ctx: FamilyContext, id: string, scope: 'this' | 'future' | 'all', meta: RequestMeta) {
    const cur = await this.loadEditable(ctx, id);
    let targets = await this.scopeTargets(ctx, cur, scope);
    if (cur.transfer_group_id) {
      targets = await this.db.selectFrom('transactions').selectAll().where('family_id', '=', ctx.familyId).where('transfer_group_id', '=', cur.transfer_group_id).where('deleted_at', 'is', null).execute();
    }
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('transactions')
        .set((eb) => ({ deleted_at: sql`CURRENT_TIMESTAMP(3)` as never, version: eb('version', '+', 1) }))
        .where('family_id', '=', ctx.familyId)
        .where('id', 'in', targets.map((t) => t.id))
        .execute();
      for (const sid of new Set(targets.map((t) => t.statement_id))) await this.billing.recalc(trx, ctx.familyId, sid);
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'transaction.delete', entityType: 'transaction', entityId: id, diff: { scope, removed: targets.map((t) => t.id), before: pick(cur) }, meta }, trx);
    });
    await this.limits.evaluateAfterChange(ctx.familyId, targets.map(toChange));
    return { removed: targets.length };
  }

  // ---------------------------------------------------------------- Regras
  private async loadEditable(ctx: FamilyContext, id: string) {
    const t = await this.db.selectFrom('transactions').selectAll().where('family_id', '=', ctx.familyId).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!t) throw Errors.notFound('Lançamento');
    await this.assertVisible(ctx, t);
    // MEMBER edita apenas os próprios lançamentos (criados por ele ou atribuídos a ele)
    if (!atLeast(ctx.role, 'ADMIN') && t.created_by !== ctx.userId && t.member_user_id !== ctx.userId) {
      throw Errors.forbidden('Você só pode alterar seus próprios lançamentos.');
    }
    if (t.account_id) await this.vis.assertAccount(ctx, t.account_id, true);
    if (t.card_id) await this.vis.assertCard(ctx, t.card_id, true);
    return t;
  }

  private async scopeTargets(ctx: FamilyContext, cur: Transaction, scope: 'this' | 'future' | 'all') {
    if (!cur.installment_plan_id || scope === 'this') return [cur];
    let q = this.db.selectFrom('transactions').selectAll().where('family_id', '=', ctx.familyId).where('installment_plan_id', '=', cur.installment_plan_id).where('deleted_at', 'is', null);
    if (scope === 'future') q = q.where('installment_number', '>=', cur.installment_number!);
    return q.orderBy('installment_number').execute();
  }

  private async assertVisible(ctx: FamilyContext, t: Pick<Transaction, 'account_id' | 'card_id'>) {
    if (this.vis.seesAll(ctx)) return;
    if (t.account_id) {
      const ids = await this.vis.visibleAccountIds(ctx);
      if (ids && !ids.includes(t.account_id)) throw Errors.notFound('Lançamento');
    }
    if (t.card_id) {
      const ids = await this.vis.visibleCardIds(ctx);
      if (ids && !ids.includes(t.card_id)) throw Errors.notFound('Lançamento');
    }
  }

  private async resolveMeans(ctx: FamilyContext, accountId?: string, cardId?: string) {
    if (!!accountId === !!cardId) throw Errors.validation([{ field: 'accountId', message: 'informe exatamente um entre accountId e cardId' }]);
    if (accountId) {
      await this.vis.assertAccount(ctx, accountId, true);
      return { accountId, cardId: null, card: null };
    }
    const card = await this.vis.assertCard(ctx, cardId!, true);
    return { accountId: null, cardId: card.id, card };
  }

  /** Categoria obrigatória, ativa, da família e do mesmo tipo do lançamento. */
  private async assertCategory(ctx: FamilyContext, categoryId: string, type: 'INCOME' | 'EXPENSE' | 'TRANSFER') {
    const c = await this.db.selectFrom('categories').select(['kind', 'is_active']).where('family_id', '=', ctx.familyId).where('id', '=', categoryId).executeTakeFirst();
    if (!c) throw Errors.unprocessable('INVALID_REFERENCE', 'Categoria inexistente nesta família.');
    if (!bool(c.is_active)) throw Errors.unprocessable('CATEGORY_INACTIVE', 'Esta categoria está desativada. Escolha outra ou reative-a em Categorias.');
    if (c.kind !== type) throw Errors.unprocessable('CATEGORY_KIND_MISMATCH', `Use uma categoria de ${type === 'INCOME' ? 'receita' : type === 'EXPENSE' ? 'despesa' : 'transferência'}.`);
  }

  private async resolveMember(ctx: FamilyContext, memberUserId?: string) {
    if (!memberUserId || memberUserId === ctx.userId) return ctx.userId;
    const m = await this.db.selectFrom('family_members').select('user_id').where('family_id', '=', ctx.familyId).where('user_id', '=', memberUserId).where('status', '=', 'ACTIVE').executeTakeFirst();
    if (!m) throw Errors.unprocessable('INVALID_REFERENCE', 'Membro inexistente nesta família.');
    return memberUserId;
  }

  private async systemCategory(familyId: string, name: string) {
    const c = await this.db.selectFrom('categories').select('id').where('family_id', '=', familyId).where('kind', '=', 'TRANSFER').where('name', '=', name).executeTakeFirst();
    if (!c) throw Errors.unprocessable('SYSTEM_CATEGORY_MISSING', `Categoria de sistema "${name}" ausente.`);
    return c.id;
  }

  private async findDuplicate(familyId: string, fp: string) {
    const d = await this.db.selectFrom('transactions').select(['id', 'description', 'occurred_on', 'amount']).where('family_id', '=', familyId).where('fingerprint', '=', fp).where('deleted_at', 'is', null).executeTakeFirst();
    return d ? { id: d.id, description: d.description, occurredOn: d.occurred_on, amount: d.amount } : null;
  }

  private async alertSummaries(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db
      .selectFrom('alerts as a')
      .innerJoin('spending_limits as l', 'l.id', 'a.limit_id')
      .select(['a.id', 'a.level', 'a.threshold_pct', 'a.consumed_amount', 'a.limit_amount', 'l.name'])
      .where('a.id', 'in', ids)
      .execute();
    return rows.map((r) => ({ id: r.id, level: r.level, thresholdPct: r.threshold_pct, limitName: r.name, consumedPct: Math.floor((toCents(r.consumed_amount) * 100) / toCents(r.limit_amount)) }));
  }
}

// ---------------------------------------------------------------- Mapeamento
type JoinedRow = Transaction & {
  category_name: string; category_color: string | null; category_parent_id: string | null; account_name: string | null;
  card_name: string | null; member_name: string | null; statement_month: string | null; statement_due: string | null;
};

export function toDto(r: JoinedRow) {
  return {
    id: r.id, type: r.type, amount: r.amount, description: r.description, occurredOn: r.occurred_on, status: r.status, source: r.source,
    category: { id: r.category_id, name: r.category_name, color: r.category_color, parentId: r.category_parent_id },
    account: r.account_id ? { id: r.account_id, name: r.account_name } : null,
    card: r.card_id ? { id: r.card_id, name: r.card_name } : null,
    statement: r.statement_id ? { id: r.statement_id, referenceMonth: r.statement_month, dueDate: r.statement_due } : null,
    member: r.member_user_id ? { id: r.member_user_id, name: r.member_name } : null,
    installment: r.installment_plan_id ? { planId: r.installment_plan_id, number: r.installment_number } : null,
    transferGroupId: r.transfer_group_id, notes: r.notes, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toChange(t: Pick<NewTransaction, 'type' | 'occurred_on' | 'category_id' | 'account_id' | 'card_id' | 'member_user_id'>): TxChange {
  return { type: t.type, occurred_on: t.occurred_on, category_id: t.category_id, account_id: t.account_id ?? null, card_id: t.card_id ?? null, member_user_id: t.member_user_id ?? null };
}

const pick = (t: Transaction) => ({ amount: t.amount, description: t.description, occurredOn: t.occurred_on, categoryId: t.category_id, version: t.version });

