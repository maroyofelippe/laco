import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit.service';
import { Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { DATE_RE } from '../../common/dto';
import { Errors } from '../../common/errors';
import { InjectDb, type Db } from '../../db/database';
import { pctOf } from './limits.service';

class AlertsQuery {
  @ApiPropertyOptional({ description: 'Devolve só alertas com seq maior que este cursor (consulta incremental)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) since?: number;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'RESOLVED', 'DISMISSED'] }) @IsOptional() @IsIn(['ACTIVE', 'RESOLVED', 'DISMISSED']) status?: 'ACTIVE' | 'RESOLVED' | 'DISMISSED';
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE) from?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE_RE) to?: string;
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

@ApiTags('Alertas')
@ApiBearerAuth()
@Controller('families/:familyId/alerts')
export class AlertsController {
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Alertas destinados ao usuário; use ?since=<cursor> para buscar só os novos' })
  async list(@Family() ctx: FamilyContext, @Query() q: AlertsQuery) {
    let query = this.db
      .selectFrom('alerts as a')
      .innerJoin('alert_receipts as r', (j) => j.onRef('r.alert_id', '=', 'a.id').on('r.user_id', '=', ctx.userId))
      .innerJoin('spending_limits as l', 'l.id', 'a.limit_id')
      .select([
        'a.id', 'a.seq', 'a.level', 'a.threshold_pct', 'a.status', 'a.consumed_amount', 'a.limit_amount', 'a.period_start', 'a.period_end',
        'a.created_at', 'a.resolved_at', 'r.read_at', 'l.id as limit_id', 'l.name as limit_name', 'l.scope_type', 'l.amount as current_limit_amount',
      ])
      .where('a.family_id', '=', ctx.familyId);
    if (q.since !== undefined) query = query.where('a.seq', '>', String(q.since));
    if (q.status) query = query.where('a.status', '=', q.status);
    if (q.from) query = query.where('a.created_at', '>=', `${q.from} 00:00:00`);
    if (q.to) query = query.where('a.created_at', '<=', `${q.to} 23:59:59.999`);
    const rows = await query.orderBy('a.seq', q.since !== undefined ? 'asc' : 'desc').limit(q.limit ?? 100).execute();

    // Marca como entregue (o app recebeu)
    const undelivered = rows.map((r) => r.id);
    if (undelivered.length) {
      await this.db.updateTable('alert_receipts').set({ delivered_at: sql`NOW(3)` as never }).where('user_id', '=', ctx.userId).where('alert_id', 'in', undelivered).where('delivered_at', 'is', null).execute();
    }
    const unread = await this.db
      .selectFrom('alert_receipts as r')
      .innerJoin('alerts as a', 'a.id', 'r.alert_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('r.user_id', '=', ctx.userId)
      .where('a.family_id', '=', ctx.familyId)
      .where('a.status', '=', 'ACTIVE')
      .where('r.read_at', 'is', null)
      .executeTakeFirstOrThrow();
    const maxSeq = rows.reduce((m, r) => Math.max(m, Number(r.seq)), q.since ?? 0);

    return {
      data: rows.map((r) => ({
        id: r.id, seq: Number(r.seq), level: r.level, thresholdPct: r.threshold_pct, status: r.status,
        limit: { id: r.limit_id, name: r.limit_name, scopeType: r.scope_type, amount: r.limit_amount },
        consumed: r.consumed_amount, consumedPct: pctOf(r.consumed_amount, r.limit_amount),
        period: { start: r.period_start, end: r.period_end }, createdAt: r.created_at, resolvedAt: r.resolved_at, readAt: r.read_at,
      })),
      cursor: maxSeq,
      unreadCount: Number(unread.n),
    };
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.db
      .updateTable('alert_receipts')
      .set({ read_at: sql`COALESCE(read_at, NOW(3))` as never })
      .where('alert_id', '=', id)
      .where('user_id', '=', ctx.userId)
      .where('alert_id', 'in', (eb) => eb.selectFrom('alerts').select('id').where('family_id', '=', ctx.familyId))
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) {
      const exists = await this.db.selectFrom('alert_receipts').select('alert_id').where('alert_id', '=', id).where('user_id', '=', ctx.userId).executeTakeFirst();
      if (!exists) throw Errors.notFound('Alerta');
    }
  }

  @Post(':id/dismiss')
  @MinRole('ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Dispensa o alerta para toda a família (ADMIN)' })
  async dismiss(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const r = await this.db.updateTable('alerts').set({ status: 'DISMISSED' }).where('family_id', '=', ctx.familyId).where('id', '=', id).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw Errors.notFound('Alerta');
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'alert.dismiss', entityType: 'alert', entityId: id, meta });
  }
}
