import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDb, type Db } from '../db/database';
import type { Role } from '../db/types';
import { atLeast, IS_PUBLIC, MIN_ROLE, type AppRequest } from './context';
import { Errors } from './errors';
import { TokenService } from './token.service';

/** Global: exige Bearer válido, exceto em rotas @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw Errors.unauthorized();
    req.user = await this.tokens.verifyAccess(token);
    return true;
  }
}

const ROLE_PT: Record<Role, string> = { OWNER: 'titular', ADMIN: 'administrador(a)', MEMBER: 'membro', VIEWER: 'leitor(a)' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global: em toda rota com :familyId confirma que o usuário é membro ATIVO
 * daquela família e aplica @MinRole. Não membro recebe 404 (não revela existência).
 */
@Injectable()
export class FamilyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @InjectDb() private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const raw = req.params?.familyId;
    const familyId = Array.isArray(raw) ? raw[0] : raw;
    if (!familyId) return true;
    if (!req.user) throw Errors.unauthorized();
    if (!UUID_RE.test(familyId)) throw Errors.notFound('Família');

    const member = await this.db
      .selectFrom('family_members as m')
      .innerJoin('families as f', 'f.id', 'm.family_id')
      .select(['m.role'])
      .where('m.family_id', '=', familyId)
      .where('m.user_id', '=', req.user.id)
      .where('m.status', '=', 'ACTIVE')
      .where('f.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!member) throw Errors.notFound('Família');

    req.family = { familyId, userId: req.user.id, role: member.role };

    const min = this.reflector.getAllAndOverride<Role | undefined>(MIN_ROLE, [ctx.getHandler(), ctx.getClass()]);
    if (min && !atLeast(member.role, min)) {
      throw Errors.forbidden(`Como ${ROLE_PT[member.role]}, você não pode fazer isso nesta família. Fale com quem administra a família.`);
    }
    return true;
  }
}
