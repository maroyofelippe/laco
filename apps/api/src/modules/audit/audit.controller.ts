import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Family, MinRole, type FamilyContext } from '../../common/context';
import { PageQuery } from '../../common/dto';
import { decodeCursor, encodeCursor } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';

class AuditQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'transaction' }) @IsOptional() @IsString() @MaxLength(40) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
}

@ApiTags('Auditoria')
@ApiBearerAuth()
@Controller('families/:familyId/audit-logs')
export class AuditController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Get()
  @MinRole('ADMIN')
  async list(@Family() ctx: FamilyContext, @Query() q: AuditQuery) {
    const limit = q.limit ?? 50;
    let query = this.db
      .selectFrom('audit_logs as l')
      .leftJoin('users as u', 'u.id', 'l.actor_user_id')
      .select(['l.id', 'l.action', 'l.entity_type as entityType', 'l.entity_id as entityId', 'l.diff', 'l.created_at as createdAt', 'u.name as actorName', 'l.actor_user_id as actorUserId'])
      .where('l.family_id', '=', ctx.familyId);
    if (q.entityType) query = query.where('l.entity_type', '=', q.entityType);
    if (q.actorUserId) query = query.where('l.actor_user_id', '=', q.actorUserId);
    const cur = decodeCursor<{ id: number }>(q.cursor);
    if (cur) query = query.where('l.id', '<', cur.id);
    const rows = await query.orderBy('l.id', 'desc').limit(limit + 1).execute();
    const data = rows.slice(0, limit);
    return { data, nextCursor: rows.length > limit ? encodeCursor({ id: data.at(-1)!.id }) : null };
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
