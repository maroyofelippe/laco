import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../../common/audit.service';
import { atLeast, Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { DATE_MSG, DATE_RE, MONEY_MSG, MONEY_RE } from '../../common/dto';
import { Errors } from '../../common/errors';
import { bool, newId } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import type { RecurrenceTemplate } from './recurrences.service';
import { RecurrencesService } from './recurrences.service';

class CreateRecurrenceDto {
  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] }) @IsIn(['INCOME', 'EXPENSE']) type: 'INCOME' | 'EXPENSE';
  @ApiProperty({ example: '129.90' }) @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount: string;
  @ApiProperty({ example: 'Internet' }) @IsString() @Length(1, 200) description: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() memberUserId?: string;
  @ApiProperty({ enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] }) @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']) frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(12) intervalN?: number;
  @ApiProperty({ example: '2026-11-10' }) @Matches(DATE_RE, { message: `startDate ${DATE_MSG}` }) startDate: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, { message: `endDate ${DATE_MSG}` }) endDate?: string;
}

class UpdateRecurrenceDto {
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY_RE, { message: `amount ${MONEY_MSG}` }) amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE, { message: `endDate ${DATE_MSG}` }) endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

@ApiTags('Recorrências')
@ApiBearerAuth()
@Controller('families/:familyId/recurrences')
export class RecurrencesController {
  constructor(@InjectDb() private readonly db: Db, private readonly svc: RecurrencesService, private readonly vis: VisibilityService, private readonly audit: AuditService) {}

  @Get()
  async list(@Family() ctx: FamilyContext) {
    const rows = await this.db.selectFrom('recurrence_rules').selectAll().where('family_id', '=', ctx.familyId).orderBy('is_active', 'desc').orderBy('next_run_date').execute();
    return rows.map(toDto);
  }

  @Post()
  @MinRole('MEMBER')
  @ApiOperation({ summary: 'Cria lançamento recorrente; ocorrências até hoje são geradas na hora' })
  async create(@Family() ctx: FamilyContext, @Body() dto: CreateRecurrenceDto, @Meta() meta: RequestMeta) {
    if (!!dto.accountId === !!dto.cardId) throw Errors.validation([{ field: 'accountId', message: 'informe exatamente um entre accountId e cardId' }]);
    if (dto.endDate && dto.endDate < dto.startDate) throw Errors.validation([{ field: 'endDate', message: 'deve ser igual ou posterior a startDate' }]);
    if (dto.accountId) await this.vis.assertAccount(ctx, dto.accountId, true);
    if (dto.cardId) await this.vis.assertCard(ctx, dto.cardId, true);
    const cat = await this.db.selectFrom('categories').select(['kind', 'is_active']).where('family_id', '=', ctx.familyId).where('id', '=', dto.categoryId).executeTakeFirst();
    if (!cat) throw Errors.unprocessable('INVALID_REFERENCE', 'Categoria inexistente nesta família.');
    if (!bool(cat.is_active)) throw Errors.unprocessable('CATEGORY_INACTIVE', 'Esta categoria está desativada. Escolha outra ou reative-a em Categorias.');
    if (cat.kind !== dto.type) throw Errors.unprocessable('CATEGORY_KIND_MISMATCH', `Use uma categoria de ${dto.type === 'INCOME' ? 'receita' : 'despesa'}.`);
    const id = newId();
    const template: RecurrenceTemplate = { type: dto.type, amount: dto.amount, description: dto.description.trim(), categoryId: dto.categoryId, accountId: dto.accountId ?? null, cardId: dto.cardId ?? null, memberUserId: dto.memberUserId ?? ctx.userId };
    await this.db
      .insertInto('recurrence_rules')
      .values({ id, family_id: ctx.familyId, frequency: dto.frequency, interval_n: dto.intervalN ?? 1, day_of_month: ['MONTHLY', 'YEARLY'].includes(dto.frequency) ? Number(dto.startDate.slice(8, 10)) : null, start_date: dto.startDate, end_date: dto.endDate ?? null, template: JSON.stringify(template), next_run_date: dto.startDate, is_active: true, created_by: ctx.userId })
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'recurrence.create', entityType: 'recurrence', entityId: id, diff: dto, meta });
    const generated = await this.svc.runRule(id);
    return { ...(await this.get(ctx, id)), generatedNow: generated };
  }

  @Post('run')
  @MinRole('ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gera agora as ocorrências pendentes da família (também roda a cada hora)' })
  async run(@Family() ctx: FamilyContext) {
    return { created: await this.svc.runDue(ctx.familyId) };
  }

  @Get(':id')
  async get(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.find(ctx, id));
  }

  @Patch(':id')
  @MinRole('MEMBER')
  @ApiOperation({ summary: 'Altera as próximas ocorrências (as já lançadas não mudam)' })
  async update(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecurrenceDto, @Meta() meta: RequestMeta) {
    const r = await this.find(ctx, id);
    this.assertOwner(ctx, r.created_by);
    const t = { ...(r.template as unknown as RecurrenceTemplate) };
    if (dto.categoryId) {
      const cat = await this.db.selectFrom('categories').select(['kind', 'is_active']).where('family_id', '=', ctx.familyId).where('id', '=', dto.categoryId).executeTakeFirst();
      if (!cat || !bool(cat.is_active) || cat.kind !== t.type) throw Errors.unprocessable('CATEGORY_KIND_MISMATCH', 'Escolha uma categoria ativa do mesmo tipo do lançamento.');
      t.categoryId = dto.categoryId;
    }
    if (dto.amount) t.amount = dto.amount;
    if (dto.description) t.description = dto.description.trim();
    await this.db
      .updateTable('recurrence_rules')
      .set({ template: JSON.stringify(t), ...(dto.endDate !== undefined ? { end_date: dto.endDate } : {}), ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}) })
      .where('family_id', '=', ctx.familyId)
      .where('id', '=', id)
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'recurrence.update', entityType: 'recurrence', entityId: id, diff: dto, meta });
    if (dto.isActive) await this.svc.runRule(id);
    return this.get(ctx, id);
  }

  @Delete(':id')
  @MinRole('MEMBER')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra a recorrência (lançamentos já gerados permanecem)' })
  async remove(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const r = await this.find(ctx, id);
    this.assertOwner(ctx, r.created_by);
    await this.db.updateTable('recurrence_rules').set({ is_active: false }).where('family_id', '=', ctx.familyId).where('id', '=', id).execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'recurrence.end', entityType: 'recurrence', entityId: id, meta });
  }

  private assertOwner(ctx: FamilyContext, createdBy: string) {
    if (!atLeast(ctx.role, 'ADMIN') && createdBy !== ctx.userId) throw Errors.forbidden('Você só pode alterar as recorrências que criou.');
  }

  private async find(ctx: FamilyContext, id: string) {
    const r = await this.db.selectFrom('recurrence_rules').selectAll().where('family_id', '=', ctx.familyId).where('id', '=', id).executeTakeFirst();
    if (!r) throw Errors.notFound('Recorrência');
    return r;
  }
}

function toDto(r: { id: string; frequency: string; interval_n: number; day_of_month: number | null; start_date: string; end_date: string | null; template: unknown; next_run_date: string; is_active: number; created_by: string }) {
  const t = r.template as RecurrenceTemplate;
  return {
    id: r.id, frequency: r.frequency, intervalN: r.interval_n, dayOfMonth: r.day_of_month, startDate: r.start_date, endDate: r.end_date, nextRunDate: r.next_run_date,
    isActive: bool(r.is_active), createdBy: r.created_by, type: t.type, amount: t.amount, description: t.description, categoryId: t.categoryId, accountId: t.accountId, cardId: t.cardId, memberUserId: t.memberUserId,
  };
}
