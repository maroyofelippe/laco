import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit.service';
import { Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { DATE_MSG, DATE_RE, MONEY_MSG, MONEY_RE } from '../../common/dto';
import { Errors } from '../../common/errors';
import { bool, fromCents, newId, normalizeDescription, sha256, toCents, today } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import type { CreditCard } from '../../db/types';
import { BillingCycleService } from './billing-cycle.service';

class CreateCardDto {
  @ApiProperty({ example: 'Nubank Marco' }) @IsString() @Length(1, 80) name: string;
  @ApiPropertyOptional({ example: 'Mastercard' }) @IsOptional() @IsString() @Length(1, 20) brand?: string;
  @ApiPropertyOptional({ example: '1234', description: 'Somente os 4 últimos dígitos' }) @IsOptional() @Matches(/^\d{4}$/) last4?: string;
  @ApiProperty({ example: '8000.00' }) @Matches(MONEY_RE, { message: `creditLimit ${MONEY_MSG}` }) creditLimit: string;
  @ApiProperty({ example: 3 }) @IsInt() @Min(1) @Max(31) closingDay: number;
  @ApiProperty({ example: 10 }) @IsInt() @Min(1) @Max(31) dueDay: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() paymentAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() holderUserId?: string;
  @ApiPropertyOptional({ enum: ['FAMILY', 'RESTRICTED'] }) @IsOptional() @IsIn(['FAMILY', 'RESTRICTED']) visibility?: 'FAMILY' | 'RESTRICTED';
}

class UpdateCardDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY_RE, { message: `creditLimit ${MONEY_MSG}` }) creditLimit?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(31) closingDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(31) dueDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() paymentAccountId?: string;
  @ApiPropertyOptional({ enum: ['FAMILY', 'RESTRICTED'] }) @IsOptional() @IsIn(['FAMILY', 'RESTRICTED']) visibility?: 'FAMILY' | 'RESTRICTED';
}

class PayStatementDto {
  @ApiProperty() @IsUUID() accountId: string;
  @ApiProperty({ example: '1520.33' }) @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount: string;
  @ApiPropertyOptional({ example: '2026-11-10' }) @IsOptional() @Matches(DATE_RE, { message: `paidOn ${DATE_MSG}` }) paidOn?: string;
}

@ApiTags('Cartões')
@ApiBearerAuth()
@Controller('families/:familyId/cards')
export class CardsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly vis: VisibilityService,
    private readonly audit: AuditService,
    private readonly billing: BillingCycleService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Cartões visíveis com limite usado e fatura atual' })
  async list(@Family() ctx: FamilyContext) {
    const visible = await this.vis.visibleCardIds(ctx);
    if (visible && !visible.length) return [];
    let q = this.db.selectFrom('credit_cards').selectAll().where('family_id', '=', ctx.familyId).where('deleted_at', 'is', null);
    if (visible) q = q.where('id', 'in', visible);
    const cards = await q.orderBy('name').execute();
    return Promise.all(cards.map((c) => this.toDto(c)));
  }

  @Post()
  @MinRole('ADMIN')
  async create(@Family() ctx: FamilyContext, @Body() dto: CreateCardDto, @Meta() meta: RequestMeta) {
    if (dto.paymentAccountId) await this.vis.assertAccount(ctx, dto.paymentAccountId);
    const id = newId();
    await this.db
      .insertInto('credit_cards')
      .values({
        id, family_id: ctx.familyId, holder_user_id: dto.holderUserId ?? null, name: dto.name.trim(), brand: dto.brand ?? null,
        last4: dto.last4 ?? null, credit_limit: dto.creditLimit, closing_day: dto.closingDay, due_day: dto.dueDay,
        payment_account_id: dto.paymentAccountId ?? null, visibility: dto.visibility ?? 'FAMILY', is_active: true,
      })
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'card.create', entityType: 'card', entityId: id, diff: dto, meta });
    return this.get(ctx, id);
  }

  @Get(':id')
  async get(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDto(await this.vis.assertCard(ctx, id));
  }

  @Patch(':id')
  @MinRole('ADMIN')
  async update(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCardDto, @Headers('if-match') ifMatch: string | undefined, @Meta() meta: RequestMeta) {
    const card = await this.vis.assertCard(ctx, id, true);
    if (ifMatch && Number(ifMatch) !== card.version) throw Errors.conflict('VERSION_CONFLICT', 'O cartão foi alterado por outra pessoa. Recarregue para ver a versão atual.', { currentVersion: card.version });
    if (dto.paymentAccountId) await this.vis.assertAccount(ctx, dto.paymentAccountId);
    await this.db
      .updateTable('credit_cards')
      .set((eb) => ({
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.creditLimit ? { credit_limit: dto.creditLimit } : {}),
        ...(dto.closingDay ? { closing_day: dto.closingDay } : {}),
        ...(dto.dueDay ? { due_day: dto.dueDay } : {}),
        ...(dto.paymentAccountId ? { payment_account_id: dto.paymentAccountId } : {}),
        ...(dto.visibility ? { visibility: dto.visibility } : {}),
        version: eb('version', '+', 1),
      }))
      .where('family_id', '=', ctx.familyId)
      .where('id', '=', id)
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'card.update', entityType: 'card', entityId: id, diff: dto, meta });
    return this.get(ctx, id);
  }

  @Delete(':id')
  @MinRole('ADMIN')
  @HttpCode(204)
  async remove(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    await this.vis.assertCard(ctx, id, true);
    await this.db.updateTable('credit_cards').set({ deleted_at: sql`CURRENT_TIMESTAMP(3)` as never, is_active: false }).where('family_id', '=', ctx.familyId).where('id', '=', id).execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'card.delete', entityType: 'card', entityId: id, meta });
  }

  @Get(':id/statements')
  async statements(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.vis.assertCard(ctx, id);
    const rows = await this.db.selectFrom('card_statements').selectAll().where('family_id', '=', ctx.familyId).where('card_id', '=', id).orderBy('reference_month', 'desc').limit(36).execute();
    return rows.map(statementDto);
  }

  @Get(':id/statements/:sid')
  async statement(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string) {
    await this.vis.assertCard(ctx, id);
    const st = await this.db.selectFrom('card_statements').selectAll().where('family_id', '=', ctx.familyId).where('card_id', '=', id).where('id', '=', sid).executeTakeFirst();
    if (!st) throw Errors.notFound('Fatura');
    const items = await this.db
      .selectFrom('transactions as t')
      .innerJoin('categories as c', 'c.id', 't.category_id')
      .select(['t.id', 't.type', 't.amount', 't.description', 't.occurred_on as occurredOn', 't.installment_number as installmentNumber', 'c.name as categoryName'])
      .where('t.family_id', '=', ctx.familyId)
      .where('t.statement_id', '=', sid)
      .where('t.deleted_at', 'is', null)
      .orderBy('t.occurred_on')
      .execute();
    return { ...statementDto(st), items };
  }

  @Post(':id/statements/:sid/payments')
  @MinRole('MEMBER')
  @ApiOperation({ summary: 'Registra pagamento da fatura a partir de uma conta' })
  async pay(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string, @Body() dto: PayStatementDto, @Meta() meta: RequestMeta) {
    const card = await this.vis.assertCard(ctx, id, true);
    await this.vis.assertAccount(ctx, dto.accountId, true);
    const st = await this.db.selectFrom('card_statements').selectAll().where('family_id', '=', ctx.familyId).where('card_id', '=', id).where('id', '=', sid).executeTakeFirst();
    if (!st) throw Errors.notFound('Fatura');
    const cat = await this.db.selectFrom('categories').select('id').where('family_id', '=', ctx.familyId).where('kind', '=', 'TRANSFER').where('name', '=', 'Pagamento de fatura').executeTakeFirstOrThrow();
    const paidOn = dto.paidOn ?? today();
    const description = `Pagamento fatura ${card.name} ${st.reference_month}`;
    const txId = newId();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('transactions')
        .values({
          id: txId, family_id: ctx.familyId, type: 'CARD_PAYMENT', amount: dto.amount, description,
          normalized_description: normalizeDescription(description), category_id: cat.id, account_id: dto.accountId,
          statement_id: sid, member_user_id: ctx.userId, occurred_on: paidOn, created_by: ctx.userId,
          fingerprint: sha256([ctx.familyId, dto.accountId, paidOn, dto.amount, sid].join('|')),
        })
        .execute();
      await this.billing.recalc(trx, ctx.familyId, sid);
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'statement.pay', entityType: 'statement', entityId: sid, diff: dto, meta }, trx);
    });
    return this.statement(ctx, id, sid);
  }

  private async toDto(c: CreditCard) {
    const current = this.billing.datesFor(c, today());
    const open = await this.db.selectFrom('card_statements').selectAll().where('card_id', '=', c.id).where('reference_month', '=', current.referenceMonth).executeTakeFirst();
    const unpaid = await this.db
      .selectFrom('card_statements')
      .select(sql<string>`COALESCE(SUM(GREATEST(total_amount - paid_amount, 0)), 0)`.as('used'))
      .where('card_id', '=', c.id)
      .where('status', '<>', 'PAID')
      .executeTakeFirstOrThrow();
    const used = toCents(unpaid.used);
    return {
      id: c.id, name: c.name, brand: c.brand, last4: c.last4, creditLimit: c.credit_limit, closingDay: c.closing_day, dueDay: c.due_day,
      paymentAccountId: c.payment_account_id, holderUserId: c.holder_user_id, visibility: c.visibility, isActive: bool(c.is_active), version: c.version,
      usedLimit: fromCents(used), availableLimit: fromCents(Math.max(0, toCents(c.credit_limit) - used)),
      currentStatement: open ? statementDto(open) : { referenceMonth: current.referenceMonth, closingDate: current.closingDate, dueDate: current.dueDate, totalAmount: '0.00', paidAmount: '0.00', status: 'OPEN' },
    };
  }
}

export function statementDto(s: { id?: string; reference_month: string; closing_date: string; due_date: string; total_amount: string; paid_amount: string; status: string; card_id?: string }) {
  return { id: s.id, cardId: s.card_id, referenceMonth: s.reference_month, closingDate: s.closing_date, dueDate: s.due_date, totalAmount: s.total_amount, paidAmount: s.paid_amount, status: s.status };
}
