import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../db/types';

export interface AuthUser {
  id: string;
  email: string;
}

export interface FamilyContext {
  familyId: string;
  userId: string;
  role: Role;
}

export type AppRequest = Request & { id?: string; user?: AuthUser; family?: FamilyContext };

export const IS_PUBLIC = 'isPublic';
/** Rota sem autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const MIN_ROLE = 'minRole';
/** Papel mínimo na família da rota (OWNER > ADMIN > MEMBER > VIEWER). */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE, role);

export const ROLE_RANK: Record<Role, number> = { VIEWER: 1, MEMBER: 2, ADMIN: 3, OWNER: 4 };
export const atLeast = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AppRequest>().user!;
});

/** Contexto da família validado pelo FamilyGuard (membro ativo + papel). */
export const Family = createParamDecorator((_: unknown, ctx: ExecutionContext): FamilyContext => {
  const fam = ctx.switchToHttp().getRequest<AppRequest>().family;
  if (!fam) throw new Error('Rota sem :familyId usou @Family()');
  return fam;
});

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}
export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] ?? '').slice(0, 255) || null, requestId: req.id ? String(req.id) : null };
});
