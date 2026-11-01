import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { config } from '../../config';
import { AuditService } from '../../common/audit.service';
import type { RequestMeta } from '../../common/context';
import { Errors } from '../../common/errors';
import { TokenService } from '../../common/token.service';
import { newId, randomToken, sha256 } from '../../common/util';
import { InjectDb, type Db } from '../../db/database';
import type { LoginDto, RegisterDto } from './auth.dto';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const sqlTs = (d: Date) => d.toISOString().slice(0, 23).replace('T', ' ');

@Injectable()
export class AuthService {
  constructor(@InjectDb() private readonly db: Db, private readonly tokens: TokenService, private readonly audit: AuditService) {}

  async register(dto: RegisterDto, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    const exists = await this.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (exists) throw Errors.conflict('EMAIL_IN_USE', 'Este e-mail já está cadastrado.');
    const id = newId();
    await this.db
      .insertInto('users')
      .values({ id, email, name: dto.name.trim(), password_hash: await argon2.hash(dto.password, ARGON) })
      .execute();
    await this.audit.log({ actorUserId: id, action: 'user.register', entityType: 'user', entityId: id, meta });
    return this.issueSession(id, dto.client ?? 'ANDROID', null);
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
    // Mesmo tempo de resposta para e-mail inexistente (evita enumeração de usuários)
    if (!user) {
      await argon2.hash(dto.password, ARGON);
      throw Errors.unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    }
    if (user.status !== 'ACTIVE') throw Errors.forbidden('Usuário bloqueado.', 'USER_BLOCKED');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw Errors.locked('Muitas tentativas. Tente novamente em alguns minutos.');
    }
    if (!(await argon2.verify(user.password_hash, dto.password))) {
      const failed = user.failed_logins + 1;
      await this.db
        .updateTable('users')
        .set({
          failed_logins: failed >= MAX_FAILED ? 0 : failed,
          locked_until: failed >= MAX_FAILED ? sqlTs(new Date(Date.now() + LOCK_MINUTES * 60_000)) : null,
        })
        .where('id', '=', user.id)
        .execute();
      await this.audit.log({ actorUserId: user.id, action: 'auth.login_failed', entityType: 'user', entityId: user.id, meta });
      throw Errors.unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    }
    await this.db.updateTable('users').set({ failed_logins: 0, locked_until: null }).where('id', '=', user.id).execute();
    await this.audit.log({ actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, meta });
    return this.issueSession(user.id, dto.client ?? 'ANDROID', dto.deviceId ?? null);
  }

  /** Rotação: cada refresh só vale uma vez. Reuso de token já rotacionado revoga a cadeia inteira. */
  async refresh(refreshToken: string) {
    const row = await this.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', sha256(refreshToken))
      .executeTakeFirst();
    if (!row) throw Errors.unauthorized('REFRESH_INVALID', 'Sessão inválida. Entre novamente.');
    if (row.revoked_at) {
      await this.revokeChain(row.chain_id);
      await this.audit.log({ actorUserId: row.user_id, action: 'auth.refresh_reuse_detected', entityType: 'refresh_token', entityId: row.id });
      throw Errors.unauthorized('REFRESH_REUSED', 'Sessão encerrada por segurança. Entre novamente.');
    }
    if (new Date(row.expires_at) < new Date()) throw Errors.unauthorized('REFRESH_EXPIRED', 'Sessão expirada. Entre novamente.');
    const user = await this.db.selectFrom('users').select(['id', 'status']).where('id', '=', row.user_id).executeTakeFirst();
    if (!user || user.status !== 'ACTIVE') throw Errors.unauthorized('REFRESH_INVALID', 'Sessão inválida.');

    const next = await this.createRefresh(row.user_id, row.client, row.device_id, row.chain_id);
    const upd = await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: sqlTs(new Date()), replaced_by: next.id })
      .where('id', '=', row.id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (Number(upd.numUpdatedRows) === 0) {
      // Corrida: outro refresh simultâneo venceu; trata como reuso
      await this.revokeChain(row.chain_id);
      throw Errors.unauthorized('REFRESH_REUSED', 'Sessão encerrada por segurança. Entre novamente.');
    }
    const email = (await this.db.selectFrom('users').select('email').where('id', '=', row.user_id).executeTakeFirstOrThrow()).email;
    return {
      accessToken: await this.tokens.signAccess({ id: row.user_id, email }),
      accessTokenExpiresIn: config.jwt.accessTtl,
      refreshToken: next.token,
    };
  }

  async logout(refreshToken: string) {
    const row = await this.db.selectFrom('refresh_tokens').select(['chain_id']).where('token_hash', '=', sha256(refreshToken)).executeTakeFirst();
    if (row) await this.revokeChain(row.chain_id);
  }

  private async revokeChain(chainId: string) {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: sqlTs(new Date()) })
      .where('chain_id', '=', chainId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  private async createRefresh(userId: string, client: 'ANDROID' | 'WEB', deviceId: string | null, chainId?: string) {
    const token = `rt_${randomToken(32)}`;
    const id = newId();
    await this.db
      .insertInto('refresh_tokens')
      .values({
        id,
        user_id: userId,
        token_hash: sha256(token),
        chain_id: chainId ?? id,
        client,
        device_id: deviceId,
        expires_at: sqlTs(new Date(Date.now() + config.jwt.refreshTtlDays * 86_400_000)),
      })
      .execute();
    return { id, token };
  }

  private async issueSession(userId: string, client: 'ANDROID' | 'WEB', deviceId: string | null) {
    const user = await this.db.selectFrom('users').select(['id', 'name', 'email']).where('id', '=', userId).executeTakeFirstOrThrow();
    const refresh = await this.createRefresh(userId, client, deviceId);
    const families = await this.db
      .selectFrom('family_members as m')
      .innerJoin('families as f', 'f.id', 'm.family_id')
      .select(['f.id', 'f.name', 'm.role'])
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'ACTIVE')
      .where('f.deleted_at', 'is', null)
      .orderBy('f.name')
      .execute();
    return {
      accessToken: await this.tokens.signAccess({ id: user.id, email: user.email }),
      accessTokenExpiresIn: config.jwt.accessTtl,
      refreshToken: refresh.token,
      user,
      families,
    };
  }
}
