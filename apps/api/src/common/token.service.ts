import { Injectable } from '@nestjs/common';
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type KeyLike } from 'jose';
import { config } from '../config';
import { Errors } from './errors';
import type { AuthUser } from './context';

/** Access token JWT ES256 de curta duração. Refresh tokens são opacos (ver AuthService). */
@Injectable()
export class TokenService {
  private keys?: Promise<{ priv: KeyLike; pub: KeyLike }>;

  private load() {
    this.keys ??= (async () => ({
      priv: await importPKCS8(config.jwt.privateKey, 'ES256'),
      pub: await importSPKI(config.jwt.publicKey, 'ES256'),
    }))();
    return this.keys;
  }

  async signAccess(user: AuthUser): Promise<string> {
    const { priv } = await this.load();
    return new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(config.jwt.issuer)
      .setAudience(config.jwt.audience)
      .setIssuedAt()
      .setExpirationTime(`${config.jwt.accessTtl}s`)
      .sign(priv);
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    const { pub } = await this.load();
    try {
      const { payload } = await jwtVerify(token, pub, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        algorithms: ['ES256'],
      });
      return { id: String(payload.sub), email: String(payload.email) };
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_JWT_EXPIRED') throw Errors.unauthorized('TOKEN_EXPIRED', 'Token expirado');
      throw Errors.unauthorized('TOKEN_INVALID', 'Token inválido');
    }
  }
}
