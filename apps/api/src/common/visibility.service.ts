import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectDb, type Db } from '../db/database';
import { atLeast, type FamilyContext } from './context';
import { Errors } from './errors';

/**
 * Visibilidade por recurso: contas e cartões FAMILY são vistos por todos os membros;
 * RESTRICTED só por OWNER/ADMIN, pelo titular ou por quem recebeu permissão.
 */
@Injectable()
export class VisibilityService {
  constructor(@InjectDb() private readonly db: Db) {}

  seesAll(ctx: FamilyContext) {
    return atLeast(ctx.role, 'ADMIN');
  }

  /** null = sem restrição (admin). */
  async visibleAccountIds(ctx: FamilyContext): Promise<string[] | null> {
    if (this.seesAll(ctx)) return null;
    const rows = await this.db
      .selectFrom('accounts as a')
      .select('a.id')
      .where('a.family_id', '=', ctx.familyId)
      .where((eb) =>
        eb.or([
          eb('a.visibility', '=', 'FAMILY'),
          eb('a.owner_user_id', '=', ctx.userId),
          eb.exists(
            eb.selectFrom('member_resource_permissions as p')
              .select(sql`1`.as('x'))
              .whereRef('p.resource_id', '=', 'a.id')
              .where('p.family_id', '=', ctx.familyId)
              .where('p.user_id', '=', ctx.userId)
              .where('p.resource_type', '=', 'ACCOUNT'),
          ),
        ]),
      )
      .execute();
    return rows.map((r) => r.id);
  }

  async visibleCardIds(ctx: FamilyContext): Promise<string[] | null> {
    if (this.seesAll(ctx)) return null;
    const rows = await this.db
      .selectFrom('credit_cards as c')
      .select('c.id')
      .where('c.family_id', '=', ctx.familyId)
      .where((eb) =>
        eb.or([
          eb('c.visibility', '=', 'FAMILY'),
          eb('c.holder_user_id', '=', ctx.userId),
          eb.exists(
            eb.selectFrom('member_resource_permissions as p')
              .select(sql`1`.as('x'))
              .whereRef('p.resource_id', '=', 'c.id')
              .where('p.family_id', '=', ctx.familyId)
              .where('p.user_id', '=', ctx.userId)
              .where('p.resource_type', '=', 'CARD'),
          ),
        ]),
      )
      .execute();
    return rows.map((r) => r.id);
  }

  /** Carrega a conta garantindo família + visibilidade; edit exige FAMILY, titularidade ou permissão EDIT. */
  async assertAccount(ctx: FamilyContext, accountId: string, edit = false) {
    const acc = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('family_id', '=', ctx.familyId)
      .where('id', '=', accountId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!acc) throw Errors.notFound('Conta');
    if (this.seesAll(ctx) || acc.visibility === 'FAMILY' || acc.owner_user_id === ctx.userId) return acc;
    const perm = await this.permission(ctx, 'ACCOUNT', accountId);
    if (!perm) throw Errors.notFound('Conta');
    if (edit && perm !== 'EDIT') throw Errors.forbidden('Você só tem permissão de leitura nesta conta.');
    return acc;
  }

  async assertCard(ctx: FamilyContext, cardId: string, edit = false) {
    const card = await this.db
      .selectFrom('credit_cards')
      .selectAll()
      .where('family_id', '=', ctx.familyId)
      .where('id', '=', cardId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!card) throw Errors.notFound('Cartão');
    if (this.seesAll(ctx) || card.visibility === 'FAMILY' || card.holder_user_id === ctx.userId) return card;
    const perm = await this.permission(ctx, 'CARD', cardId);
    if (!perm) throw Errors.notFound('Cartão');
    if (edit && perm !== 'EDIT') throw Errors.forbidden('Você só tem permissão de leitura neste cartão.');
    return card;
  }

  private async permission(ctx: FamilyContext, type: 'ACCOUNT' | 'CARD', id: string) {
    const p = await this.db
      .selectFrom('member_resource_permissions')
      .select('access')
      .where('family_id', '=', ctx.familyId)
      .where('user_id', '=', ctx.userId)
      .where('resource_type', '=', type)
      .where('resource_id', '=', id)
      .executeTakeFirst();
    return p?.access ?? null;
  }
}
