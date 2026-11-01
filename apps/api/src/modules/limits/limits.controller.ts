import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../../common/audit.service';
import { Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { DATE_MSG, DATE_RE, MONEY_MSG, MONEY_RE } from '../../common/dto';
import { Errors } from '../../common/errors';
import { bool, newId, today } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';
import type { LimitPeriod, LimitScope, Role, SpendingLimit } from '../../db/types';
import { LimitsService } from './limits.service';

class CreateLimitDto {
  @ApiProperty({ example: 'Lazer - mensal' }) @IsString() @Length(1, 80) name: string;
  @ApiProperty({ enum: ['FAMILY', 'CATEGORY', 'ACCOUNT', 'CARD', 'MEMBER'] }) @IsIn(['FAMILY', 'CATEGORY', 'ACCOUNT', 'CARD', 'MEMBER']) scopeType: LimitScope;
  @ApiPropertyOptional() @IsOptional() @IsUUID() scopeId?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() includeSubcategories?: boolean;
  @ApiProperty({ enum: ['WEEKLY', 'MONTHLY', 'CARD_CYCLE', 'CUSTOM'] }) @IsIn(['WEEKLY', 'MONTHLY', 'CARD_CYCLE', 'CUSTOM']) period: LimitPeriod;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, { message: `customStart ${DATE_MSG}` }) customStart?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, { message: `customEnd ${DATE_MSG}` }) customEnd?: string;
  @ApiProperty({ example: '800.00' }) @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount: string;
  @ApiPropertyOptional({ example: [80, 100], default: [80, 100] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(200, { each: true })
  thresholds?: number[];
  @ApiPropertyOptional({ example: ['OWNER', 'ADMIN', 'MEMBER'] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'], { each: true })
  notifyRoles?: Role[];
}

class UpdateLimitDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(200, { each: true }) thresholds?: number[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'], { each: true }) notifyRoles?: Role[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

class ConsumptionQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, { message: `at ${DATE_MSG}` }) at?: string;
}

@ApiTags('Limites')
@ApiBearerAuth()
@Controller('families/:familyId/limits')
export class LimitsController {
  constructor(@InjectDb() private readonly db: Db, private readonly svc: LimitsService, private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Limites com consumo do período atual' })
  async list(@Family() ctx: FamilyContext) {
    const rows = await this.db.selectFrom('spending_limits').selectAll().where('family_id', '=', ctx.familyId).orderBy('is_active', 'desc').orderBy('name').execute();
    return Promise.all(rows.map((l) => this.toDto(l)));
  }

  @Post()
  @MinRole('ADMIN')
  async create(@Family() ctx: FamilyContext, @Body() dto: CreateLimitDto, @Meta() meta: RequestMeta) {
    await this.validateScope(ctx, dto);
    const id = newId();
    await this.db
      .insertInto('spending_limits')
      .values({
        id, family_id: ctx.familyId, name: dto.name.trim(), scope_type: dto.scopeType, scope_id: dto.scopeType === 'FAMILY' ? null : dto.scopeId!,
        include_subcategories: dto.includeSubcategories ?? true, period: dto.period, custom_start: dto.customStart ?? null, custom_end: dto.customEnd ?? null,
        amount: dto.amount, thresholds: JSON.stringify([...(dto.thresholds ?? [80, 100])].sort((a, b) => a - b)),
        notify_roles: JSON.stringify(dto.notifyRoles ?? ['OWNER', 'ADMIN', 'MEMBER']), is_active: true, created_by: ctx.userId,
      })
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'limit.create', entityType: 'limit', entityId: id, diff: dto, meta });
    const limit = await this.find(ctx, id);
    await this.svc.evaluate(limit, today());
    return this.toDto(limit);
  }

  @Post('reevaluate')
  @MinRole('ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reavalia todos os limites ativos (rede de segurança; em produção roda diariamente)' })
  async reevaluate(@Family() ctx: FamilyContext) {
    const created = await this.svc.reevaluateAll(ctx.familyId);
    return { newAlerts: created.length };
  }

  @Get(':id')
  async get(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.toDto(await this.find(ctx, id));
  }

  @Patch(':id')
  @MinRole('ADMIN')
  async update(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLimitDto, @Headers('if-match') ifMatch: string | undefined, @Meta() meta: RequestMeta) {
    const lim = await this.find(ctx, id);
    if (ifMatch && Number(ifMatch) !== lim.version) throw Errors.conflict('VERSION_CONFLICT', 'O limite foi alterado por outra pessoa. Recarregue para ver a versão atual.', { currentVersion: lim.version });
    await this.db
      .updateTable('spending_limits')
      .set((eb) => ({
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.amount ? { amount: dto.amount } : {}),
        ...(dto.thresholds ? { thresholds: JSON.stringify([...dto.thresholds].sort((a, b) => a - b)) } : {}),
        ...(dto.notifyRoles ? { notify_roles: JSON.stringify(dto.notifyRoles) } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        version: eb('version', '+', 1),
      }))
      .where('family_id', '=', ctx.familyId)
      .where('id', '=', id)
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'limit.update', entityType: 'limit', entityId: id, diff: { before: { amount: lim.amount, thresholds: lim.thresholds }, after: dto }, meta });
    const updated = await this.find(ctx, id);
    if (bool(updated.is_active)) await this.svc.evaluate(updated, today()); // reavalia na hora
    return this.toDto(updated);
  }

  @Delete(':id')
  @MinRole('ADMIN')
  @HttpCode(204)
  async remove(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    await this.find(ctx, id);
    await this.db.updateTable('spending_limits').set((eb) => ({ is_active: false, version: eb('version', '+', 1) })).where('family_id', '=', ctx.familyId).where('id', '=', id).execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'limit.deactivate', entityType: 'limit', entityId: id, meta });
  }

  @Get(':id/consumption')
  @ApiOperation({ summary: 'Consumo do período que contém a data, com os maiores lançamentos' })
  async consumption(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: ConsumptionQuery) {
    const lim = await this.find(ctx, id);
    const snap = await this.svc.snapshot(lim, q.at ?? today());
    let top: unknown[] = [];
    if (snap.period) {
      let tq = this.db
        .selectFrom('transactions as t')
        .innerJoin('categories as c', 'c.id', 't.category_id')
        .select(['t.id', 't.description', 't.amount', 't.occurred_on as occurredOn', 'c.name as categoryName'])
        .where('t.family_id', '=', ctx.familyId)
        .where('t.type', '=', 'EXPENSE')
        .where('t.deleted_at', 'is', null)
        .where('t.occurred_on', '>=', snap.period.start)
        .where('t.occurred_on', '<=', snap.period.end);
      if (lim.scope_type === 'CATEGORY') tq = tq.where('t.category_id', 'in', await this.svc.categoryScope(lim));
      if (lim.scope_type === 'ACCOUNT') tq = tq.where('t.account_id', '=', lim.scope_id!);
      if (lim.scope_type === 'CARD') tq = tq.where('t.card_id', '=', lim.scope_id!);
      if (lim.scope_type === 'MEMBER') tq = tq.where('t.member_user_id', '=', lim.scope_id!);
      top = await tq.orderBy('t.amount', 'desc').limit(10).execute();
    }
    return { limitId: id, amount: lim.amount, ...snap, topTransactions: top };
  }

  private async validateScope(ctx: FamilyContext, dto: CreateLimitDto) {
    if (dto.scopeType === 'FAMILY') {
      if (dto.scopeId) throw Errors.validation([{ field: 'scopeId', message: 'não se aplica ao escopo FAMILY' }]);
    } else if (!dto.scopeId) {
      throw Errors.validation([{ field: 'scopeId', message: 'obrigatório para este escopo' }]);
    }
    if (dto.period === 'CARD_CYCLE' && dto.scopeType !== 'CARD') throw Errors.validation([{ field: 'period', message: 'CARD_CYCLE exige escopo CARD' }]);
    if (dto.period === 'CUSTOM' && (!dto.customStart || !dto.customEnd || dto.customEnd < dto.customStart)) {
      throw Errors.validation([{ field: 'customEnd', message: 'informe customStart e customEnd (fim ≥ início)' }]);
    }
    const fid = ctx.familyId;
    const exists = async () => {
      switch (dto.scopeType) {
        case 'CATEGORY':
          return this.db.selectFrom('categories').select('id').where('family_id', '=', fid).where('id', '=', dto.scopeId!).where('kind', '=', 'EXPENSE').executeTakeFirst();
        case 'ACCOUNT':
          return this.db.selectFrom('accounts').select('id').where('family_id', '=', fid).where('id', '=', dto.scopeId!).where('deleted_at', 'is', null).executeTakeFirst();
        case 'CARD':
          return this.db.selectFrom('credit_cards').select('id').where('family_id', '=', fid).where('id', '=', dto.scopeId!).where('deleted_at', 'is', null).executeTakeFirst();
        case 'MEMBER':
          return this.db.selectFrom('family_members').select('user_id as id').where('family_id', '=', fid).where('user_id', '=', dto.scopeId!).where('status', '=', 'ACTIVE').executeTakeFirst();
        default:
          return { id: 'family' };
      }
    };
    if (!(await exists())) throw Errors.unprocessable('INVALID_REFERENCE', 'O escopo informado não existe nesta família.');
  }

  private async find(ctx: FamilyContext, id: string) {
    const l = await this.db.selectFrom('spending_limits').selectAll().where('family_id', '=', ctx.familyId).where('id', '=', id).executeTakeFirst();
    if (!l) throw Errors.notFound('Limite');
    return l;
  }

  private async toDto(l: SpendingLimit) {
    const snap = bool(l.is_active) ? await this.svc.snapshot(l) : null;
    return {
      id: l.id, name: l.name, scopeType: l.scope_type, scopeId: l.scope_id, includeSubcategories: bool(l.include_subcategories), period: l.period,
      customStart: l.custom_start, customEnd: l.custom_end, amount: l.amount, thresholds: l.thresholds, notifyRoles: l.notify_roles,
      isActive: bool(l.is_active), version: l.version,
      currentPeriod: snap?.period ?? null, consumed: snap?.consumed ?? null, consumedPct: snap?.consumedPct ?? null, status: snap?.status ?? 'INACTIVE',
    };
  }
}
