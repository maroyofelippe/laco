import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config';
import { AuditService } from '../../common/audit.service';
import { atLeast, type AuthUser, type FamilyContext, type RequestMeta } from '../../common/context';
import { Errors } from '../../common/errors';
import { newId, randomToken, sha256 } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';
import type { Role } from '../../db/types';
import { DEFAULT_CATEGORIES } from './default-categories';
import type { CreateInvitationDto, SetPermissionsDto, UpdateMemberDto } from './families.dto';

const INVITE_DAYS = 7;
const sqlTs = (d: Date) => d.toISOString().slice(0, 23).replace('T', ' ');

@Injectable()
export class FamiliesService {
  private readonly logger = new Logger('Families');
  constructor(@InjectDb() private readonly db: Db, private readonly audit: AuditService) {}

  async create(user: AuthUser, name: string, meta: RequestMeta) {
    const familyId = newId();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('families').values({ id: familyId, name: name.trim(), created_by: user.id }).execute();
      await trx.insertInto('family_members').values({ family_id: familyId, user_id: user.id, role: 'OWNER' }).execute();
      for (const c of DEFAULT_CATEGORIES) {
        const parentId = newId();
        await trx
          .insertInto('categories')
          .values({ id: parentId, family_id: familyId, name: c.name, kind: c.kind, icon: c.icon, color: c.color, is_system: !!c.system, is_active: true })
          .execute();
        for (const child of c.children ?? []) {
          await trx
            .insertInto('categories')
            .values({ id: newId(), family_id: familyId, parent_id: parentId, name: child, kind: c.kind, color: c.color, is_system: false, is_active: true })
            .execute();
        }
      }
      await this.audit.log({ familyId, actorUserId: user.id, action: 'family.create', entityType: 'family', entityId: familyId, diff: { name }, meta }, trx);
    });
    return this.get({ familyId, userId: user.id, role: 'OWNER' });
  }

  async get(ctx: FamilyContext) {
    const fam = await this.db
      .selectFrom('families')
      .select(['id', 'name', 'currency', 'timezone', 'created_at as createdAt'])
      .where('id', '=', ctx.familyId)
      .executeTakeFirstOrThrow();
    const members = await this.db
      .selectFrom('family_members')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('family_id', '=', ctx.familyId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirstOrThrow();
    return { ...fam, myRole: ctx.role, activeMembers: Number(members.n) };
  }

  async update(ctx: FamilyContext, name: string | undefined, meta: RequestMeta) {
    if (name) {
      await this.db.updateTable('families').set({ name: name.trim() }).where('id', '=', ctx.familyId).execute();
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'family.update', entityType: 'family', entityId: ctx.familyId, diff: { name }, meta });
    }
    return this.get(ctx);
  }

  listMembers(ctx: FamilyContext) {
    return this.db
      .selectFrom('family_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id as userId', 'u.name', 'u.email', 'm.display_name as displayName', 'm.role', 'm.status', 'm.joined_at as joinedAt'])
      .where('m.family_id', '=', ctx.familyId)
      .where('m.status', '<>', 'REMOVED')
      .orderBy('m.joined_at')
      .execute();
  }

  async updateMember(ctx: FamilyContext, userId: string, dto: UpdateMemberDto, meta: RequestMeta) {
    const target = await this.member(ctx.familyId, userId);
    this.assertCanManage(ctx, target.role, dto.role);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('family_members')
        .set({
          ...(dto.role ? { role: dto.role } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.displayName !== undefined ? { display_name: dto.displayName } : {}),
        })
        .where('family_id', '=', ctx.familyId)
        .where('user_id', '=', userId)
        .execute();
      await this.assertHasOwner(trx, ctx.familyId);
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'member.update', entityType: 'member', entityId: userId, diff: { before: { role: target.role, status: target.status }, after: dto }, meta }, trx);
    });
    return (await this.listMembers(ctx)).find((m) => m.userId === userId);
  }

  async removeMember(ctx: FamilyContext, userId: string, meta: RequestMeta) {
    const target = await this.member(ctx.familyId, userId);
    const leaving = userId === ctx.userId;
    if (!leaving) {
      if (!atLeast(ctx.role, 'ADMIN')) throw Errors.forbidden();
      this.assertCanManage(ctx, target.role);
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('family_members').set({ status: 'REMOVED' }).where('family_id', '=', ctx.familyId).where('user_id', '=', userId).execute();
      await trx.deleteFrom('member_resource_permissions').where('family_id', '=', ctx.familyId).where('user_id', '=', userId).execute();
      await this.assertHasOwner(trx, ctx.familyId);
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: leaving ? 'member.leave' : 'member.remove', entityType: 'member', entityId: userId, meta }, trx);
    });
  }

  async getPermissions(ctx: FamilyContext, userId: string) {
    await this.member(ctx.familyId, userId);
    return this.db
      .selectFrom('member_resource_permissions')
      .select(['resource_type as resourceType', 'resource_id as resourceId', 'access'])
      .where('family_id', '=', ctx.familyId)
      .where('user_id', '=', userId)
      .execute();
  }

  async setPermissions(ctx: FamilyContext, userId: string, dto: SetPermissionsDto, meta: RequestMeta) {
    await this.member(ctx.familyId, userId);
    const accIds = dto.items.filter((i) => i.resourceType === 'ACCOUNT').map((i) => i.resourceId);
    const cardIds = dto.items.filter((i) => i.resourceType === 'CARD').map((i) => i.resourceId);
    // resource_id não tem FK (aponta para duas tabelas): valida pertencimento à família aqui
    if (accIds.length) {
      const n = await this.db.selectFrom('accounts').select('id').where('family_id', '=', ctx.familyId).where('id', 'in', accIds).execute();
      if (n.length !== new Set(accIds).size) throw Errors.unprocessable('INVALID_REFERENCE', 'Conta inexistente nesta família.');
    }
    if (cardIds.length) {
      const n = await this.db.selectFrom('credit_cards').select('id').where('family_id', '=', ctx.familyId).where('id', 'in', cardIds).execute();
      if (n.length !== new Set(cardIds).size) throw Errors.unprocessable('INVALID_REFERENCE', 'Cartão inexistente nesta família.');
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('member_resource_permissions').where('family_id', '=', ctx.familyId).where('user_id', '=', userId).execute();
      if (dto.items.length) {
        await trx
          .insertInto('member_resource_permissions')
          .values(dto.items.map((i) => ({ family_id: ctx.familyId, user_id: userId, resource_type: i.resourceType, resource_id: i.resourceId, access: i.access })))
          .execute();
      }
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'member.permissions', entityType: 'member', entityId: userId, diff: dto.items, meta }, trx);
    });
    return this.getPermissions(ctx, userId);
  }

  // ------------------------------------------------------------- Convites
  async invite(ctx: FamilyContext, dto: CreateInvitationDto, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    if (dto.role === 'ADMIN' && ctx.role !== 'OWNER') throw Errors.forbidden('Somente o titular pode convidar administradores.');
    const already = await this.db
      .selectFrom('family_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.user_id')
      .where('m.family_id', '=', ctx.familyId)
      .where('u.email', '=', email)
      .where('m.status', '<>', 'REMOVED')
      .executeTakeFirst();
    if (already) throw Errors.conflict('ALREADY_MEMBER', 'Esta pessoa já faz parte da família.');

    const token = `inv_${randomToken(24)}`;
    const id = newId();
    await this.db.transaction().execute(async (trx) => {
      // Um convite pendente por e-mail: novos convites substituem o anterior
      await trx.updateTable('family_invitations').set({ status: 'REVOKED' as never }).where('family_id', '=', ctx.familyId).where('email', '=', email).where('status', '=', 'PENDING').execute();
      await trx
        .insertInto('family_invitations')
        .values({ id, family_id: ctx.familyId, email, role: dto.role, token_hash: sha256(token), invited_by: ctx.userId, expires_at: sqlTs(new Date(Date.now() + INVITE_DAYS * 86_400_000)) })
        .execute();
      await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'invitation.create', entityType: 'invitation', entityId: id, diff: { email, role: dto.role }, meta }, trx);
    });
    // Sem serviço de e-mail na fase local: o link é registrado no log e devolvido fora de produção
    const link = `laco://convite/${token}`;
    this.logger.log(`Convite para ${email}: ${link}`);
    const inv = (await this.listInvitations(ctx)).find((i) => i.id === id)!;
    return config.isProd ? inv : { ...inv, devInviteToken: token, devInviteLink: link };
  }

  listInvitations(ctx: FamilyContext) {
    return this.db
      .selectFrom('family_invitations as i')
      .innerJoin('users as u', 'u.id', 'i.invited_by')
      .select(['i.id', 'i.email', 'i.role', 'i.status', 'i.expires_at as expiresAt', 'i.created_at as createdAt', 'u.name as invitedBy'])
      .where('i.family_id', '=', ctx.familyId)
      .orderBy('i.created_at', 'desc')
      .limit(100)
      .execute();
  }

  async revokeInvitation(ctx: FamilyContext, id: string, meta: RequestMeta) {
    const r = await this.db
      .updateTable('family_invitations')
      .set({ status: 'REVOKED' as never })
      .where('family_id', '=', ctx.familyId)
      .where('id', '=', id)
      .where('status', '=', 'PENDING')
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw Errors.notFound('Convite pendente');
    await this.audit.log({ familyId: ctx.familyId, actorUserId: ctx.userId, action: 'invitation.revoke', entityType: 'invitation', entityId: id, meta });
  }

  async accept(user: AuthUser, token: string, meta: RequestMeta) {
    const inv = await this.db.selectFrom('family_invitations').selectAll().where('token_hash', '=', sha256(token)).executeTakeFirst();
    if (!inv || inv.status !== 'PENDING') throw Errors.notFound('Convite');
    if (new Date(inv.expires_at) < new Date()) {
      await this.db.updateTable('family_invitations').set({ status: 'EXPIRED' as never }).where('id', '=', inv.id).execute();
      throw Errors.unprocessable('INVITATION_EXPIRED', 'Este convite expirou. Peça um novo.');
    }
    if (inv.email !== user.email.toLowerCase()) {
      throw Errors.forbidden('Este convite foi enviado para outro e-mail.', 'INVITATION_EMAIL_MISMATCH');
    }
    await this.db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('family_members').select('status').where('family_id', '=', inv.family_id).where('user_id', '=', user.id).executeTakeFirst();
      if (existing && existing.status !== 'REMOVED') throw Errors.conflict('ALREADY_MEMBER', 'Você já faz parte desta família.');
      if (existing) {
        await trx.updateTable('family_members').set({ status: 'ACTIVE', role: inv.role }).where('family_id', '=', inv.family_id).where('user_id', '=', user.id).execute();
      } else {
        await trx.insertInto('family_members').values({ family_id: inv.family_id, user_id: user.id, role: inv.role }).execute();
      }
      await trx.updateTable('family_invitations').set({ status: 'ACCEPTED' as never, accepted_by: user.id }).where('id', '=', inv.id).execute();
      await this.audit.log({ familyId: inv.family_id, actorUserId: user.id, action: 'invitation.accept', entityType: 'invitation', entityId: inv.id, meta }, trx);
    });
    return this.get({ familyId: inv.family_id, userId: user.id, role: inv.role });
  }

  // -------------------------------------------------------------- Regras
  private async member(familyId: string, userId: string) {
    const m = await this.db
      .selectFrom('family_members')
      .select(['role', 'status'])
      .where('family_id', '=', familyId)
      .where('user_id', '=', userId)
      .where('status', '<>', 'REMOVED')
      .executeTakeFirst();
    if (!m) throw Errors.notFound('Membro');
    return m;
  }

  /** ADMIN não mexe em OWNER nem promove a OWNER; só OWNER define OWNER. */
  private assertCanManage(ctx: FamilyContext, targetRole: Role, newRole?: Role) {
    if (ctx.role === 'OWNER') return;
    if (targetRole === 'OWNER' || newRole === 'OWNER') throw Errors.forbidden('Somente o titular pode alterar titulares.');
    if (newRole === 'ADMIN' || targetRole === 'ADMIN') throw Errors.forbidden('Somente o titular pode gerenciar administradores.');
  }

  private async assertHasOwner(trx: Db, familyId: string) {
    const owner = await trx
      .selectFrom('family_members')
      .select('user_id')
      .where('family_id', '=', familyId)
      .where('role', '=', 'OWNER')
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!owner) throw Errors.unprocessable('LAST_OWNER', 'A família precisa de ao menos um titular ativo.');
  }
}
