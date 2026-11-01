import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit.service';
import { Family, Meta, MinRole, type FamilyContext, type RequestMeta } from '../../common/context';
import { DATE_MSG, DATE_RE } from '../../common/dto';
import { Errors } from '../../common/errors';
import { bool, newId, today } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import type { Account } from '../../db/types';
import { AccountsService } from './accounts.service';

const SIGNED_MONEY = /^-?\d{1,13}(\.\d{1,2})?$/;

class CreateAccountDto {
  @ApiProperty({ enum: ['CHECKING', 'SAVINGS', 'CASH'] }) @IsIn(['CHECKING', 'SAVINGS', 'CASH']) type: 'CHECKING' | 'SAVINGS' | 'CASH';
  @ApiProperty({ example: 'Itaú conta conjunta' }) @IsString() @Length(1, 80) name: string;
  @ApiPropertyOptional({ example: '341' }) @IsOptional() @Matches(/^\d{3}$/) bankCode?: string;
  @ApiProperty({ example: '1500.00' }) @Matches(SIGNED_MONEY, { message: 'openingBalance deve ser decimal em string' }) openingBalance: string;
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE_RE, { message: `openingDate ${DATE_MSG}` }) openingDate: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerUserId?: string;
  @ApiPropertyOptional({ enum: ['FAMILY', 'RESTRICTED'] }) @IsOptional() @IsIn(['FAMILY', 'RESTRICTED']) visibility?: 'FAMILY' | 'RESTRICTED';
}

class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(SIGNED_MONEY) openingBalance?: string;
  @ApiPropertyOptional({ enum: ['FAMILY', 'RESTRICTED'] }) @IsOptional() @IsIn(['FAMILY', 'RESTRICTED']) visibility?: 'FAMILY' | 'RESTRICTED';
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerUserId?: string;
}

class BalanceQuery {
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @Matches(DATE_RE, { message: `at ${DATE_MSG}` }) at?: string;
}

const toDto = (a: Account, balance?: string) => ({
  id: a.id, type: a.type, name: a.name, bankCode: a.bank_code, openingBalance: a.opening_balance, openingDate: a.opening_date,
  ownerUserId: a.owner_user_id, visibility: a.visibility, isActive: bool(a.is_active), version: a.version, balance,
});

@ApiTags('Contas')
@ApiBearerAuth()
@Controller('families/:familyId/accounts')
export class AccountsController {
  constructor(@InjectDb() private readonly db: Db, private readonly vis: VisibilityService, private readonly audit: AuditService, private readonly svc: AccountsService) {}

  @Get()
  async list(@Family() ctx: FamilyContext) {
    const visible = await this.vis.visibleAccountIds(ctx);
    if (visible && !visible.length) return [];
    let q = this.db.selectFrom('accounts').selectAll().where('family_id', '=', ctx.familyId).where('deleted_at', 'is', null);
    if (visible) q = q.where('id', 'in', visible);
    const rows = await q.orderBy('name').execute();
    const bal = await this.svc.balances(ctx.familyId, rows.map((r) => r.id));
    return rows.map((r) => toDto(r, bal.get(r.id)));
  }

  @Post()
  @MinRole('ADMIN')
  async create(@Family() ctx: FamilyContext, @Body() dto: CreateAccountDto, @Meta() meta: RequestMeta) {
    const id = newId();
    await this.db
      .insertInto('accounts')
      .values({
        id, family_id: ctx.familyId, owner_user_id: dto.ownerUserId ?? null, type: dto.type, name: dto.name.trim(), bank_code: dto.bankCode ?? null,
        opening_balance: dto.openingBalance, opening_date: dto.openingDate, visibility: dto.visibility ?? 'FAMILY', is_active: true,
      })
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'account.create', entityType: 'account', entityId: id, diff: dto, meta });
    return this.get(ctx, id);
  }

  @Get(':id')
  async get(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string) {
    const acc = await this.vis.assertAccount(ctx, id);
    const bal = await this.svc.balances(ctx.familyId, [id]);
    return toDto(acc, bal.get(id));
  }

  @Get(':id/balance')
  async balance(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: BalanceQuery) {
    await this.vis.assertAccount(ctx, id);
    const at = q.at ?? today();
    return { accountId: id, at, balance: (await this.svc.balances(ctx.familyId, [id], at)).get(id) };
  }

  @Patch(':id')
  @MinRole('ADMIN')
  async update(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto, @Headers('if-match') ifMatch: string | undefined, @Meta() meta: RequestMeta) {
    const acc = await this.vis.assertAccount(ctx, id, true);
    if (ifMatch && Number(ifMatch) !== acc.version) throw Errors.conflict('VERSION_CONFLICT', 'A conta foi alterada por outra pessoa. Recarregue para ver a versão atual.', { currentVersion: acc.version });
    await this.db
      .updateTable('accounts')
      .set((eb) => ({
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.openingBalance ? { opening_balance: dto.openingBalance } : {}),
        ...(dto.visibility ? { visibility: dto.visibility } : {}),
        ...(dto.ownerUserId ? { owner_user_id: dto.ownerUserId } : {}),
        version: eb('version', '+', 1),
      }))
      .where('family_id', '=', ctx.familyId)
      .where('id', '=', id)
      .execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'account.update', entityType: 'account', entityId: id, diff: dto, meta });
    return this.get(ctx, id);
  }

  @Delete(':id')
  @MinRole('ADMIN')
  @HttpCode(204)
  async remove(@Family() ctx: FamilyContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    await this.vis.assertAccount(ctx, id, true);
    await this.db.updateTable('accounts').set({ deleted_at: sql`CURRENT_TIMESTAMP(3)` as never, is_active: false }).where('family_id', '=', ctx.familyId).where('id', '=', id).execute();
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'account.delete', entityType: 'account', entityId: id, meta });
  }
}
