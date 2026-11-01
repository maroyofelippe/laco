import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { sql } from 'kysely';
import { Family, type FamilyContext } from '../../common/context';
import { bool } from '../../common/util';
import { VisibilityService } from '../../common/visibility.service';
import { InjectDb, type Db } from '../../db/database';
import { AccountsModule } from '../accounts/accounts.module';
import { AccountsService } from '../accounts/accounts.service';
import { toCategoryDto } from '../categories/categories.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { TransactionsService } from '../transactions/transactions.service';

class ChangesQuery {
  @ApiPropertyOptional({ description: 'Cursor da sincronização anterior (ISO 8601). Vazio = carga completa.' }) @IsOptional() @IsISO8601({ strict: true }) since?: string;
  @ApiPropertyOptional({ default: 500, maximum: 1000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}

/**
 * Sincronização incremental do app: devolve o que mudou desde o cursor (inclusive lançamentos
 * excluídos, marcados com deleted=true). O app faz upsert por id, então a sobreposição de
 * 1 segundo no cursor não duplica nada e evita perder escritas concorrentes.
 * As escritas do app seguem pelos endpoints normais com Idempotency-Key (fila offline).
 */
@ApiTags('Sincronização')
@ApiBearerAuth()
@Controller('families/:familyId/sync')
export class SyncController {
  constructor(@InjectDb() private readonly db: Db, private readonly txs: TransactionsService, private readonly vis: VisibilityService, private readonly accounts: AccountsService) {}

  @Get('changes')
  @ApiOperation({ summary: 'Mudanças desde o cursor: lançamentos (com exclusões), categorias, contas, cartões e membros' })
  async changes(@Family() ctx: FamilyContext, @Query() q: ChangesQuery) {
    const since = q.since ? new Date(q.since).toISOString() : null;
    const sinceSql = since ? since.replace('T', ' ').replace('Z', '') : null;
    const now = (await sql<{ n: string }>`SELECT NOW(3) AS n`.execute(this.db)).rows[0].n; // ISO (typeCast)
    const limit = q.limit ?? 500;

    const { rows: transactions, hasMore } = await this.txs.changesSince(ctx, since, limit);

    let cq = this.db.selectFrom('categories').selectAll().where('family_id', '=', ctx.familyId);
    if (sinceSql) cq = cq.where('updated_at', '>=', sinceSql);
    const categories = (await cq.execute()).map(toCategoryDto);

    const visibleAccs = await this.vis.visibleAccountIds(ctx);
    let aq = this.db.selectFrom('accounts').selectAll().where('family_id', '=', ctx.familyId);
    if (visibleAccs) aq = visibleAccs.length ? aq.where('id', 'in', visibleAccs) : aq.where(sql<boolean>`FALSE`);
    const accountRows = await aq.execute();
    // Saldos mudam com qualquer lançamento: contas visíveis vão sempre (são poucas)
    const balances = await this.accounts.balances(ctx.familyId, accountRows.filter((a) => !a.deleted_at).map((a) => a.id));
    const accounts = accountRows.map((a) => ({ id: a.id, type: a.type, name: a.name, bankCode: a.bank_code, visibility: a.visibility, isActive: bool(a.is_active), deleted: a.deleted_at !== null, balance: balances.get(a.id) ?? null, version: a.version }));

    const visibleCards = await this.vis.visibleCardIds(ctx);
    let kq = this.db.selectFrom('credit_cards').selectAll().where('family_id', '=', ctx.familyId);
    if (visibleCards) kq = visibleCards.length ? kq.where('id', 'in', visibleCards) : kq.where(sql<boolean>`FALSE`);
    if (sinceSql) kq = kq.where('updated_at', '>=', sinceSql);
    const cards = (await kq.execute()).map((c) => ({ id: c.id, name: c.name, brand: c.brand, last4: c.last4, creditLimit: c.credit_limit, closingDay: c.closing_day, dueDay: c.due_day, isActive: bool(c.is_active), deleted: c.deleted_at !== null, version: c.version }));

    const members = await this.db
      .selectFrom('family_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id as userId', 'u.name', 'm.role', 'm.status'])
      .where('m.family_id', '=', ctx.familyId)
      .execute();

    // Com mais páginas, o próximo cursor é o updated_at do último lançamento enviado
    const last = transactions.at(-1);
    const cursorBase = hasMore && last ? last.updatedAtRaw : now;
    const cursor = new Date(new Date(cursorBase).getTime() - 1000).toISOString();
    return {
      serverTime: now,
      cursor,
      hasMore,
      transactions: transactions.map(({ updatedAtRaw, ...t }) => t),
      categories,
      accounts,
      cards,
      members,
    };
  }
}

@Module({ imports: [TransactionsModule, AccountsModule], controllers: [SyncController] })
export class SyncModule {}
