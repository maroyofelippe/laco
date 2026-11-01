import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { InjectDb, type Db } from '../db/database';
import type { AppRequest } from './context';
import { Errors } from './errors';
import { sha256 } from './util';

/**
 * Header Idempotency-Key em POST/PATCH/DELETE: a primeira resposta bem-sucedida é
 * guardada e devolvida em reenvios (app offline reenviando o outbox). Mesma chave com
 * corpo diferente = 409 IDEMPOTENCY_MISMATCH; requisição ainda em andamento = 409.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@InjectDb() private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || !req.user || !['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
      return next.handle();
    }
    if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) throw Errors.badRequest('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key inválida');
    const userId = req.user.id;
    const hash = sha256(`${req.method} ${req.originalUrl.split('?')[0]} ${JSON.stringify(req.body ?? {})}`);

    return from(this.reserve(userId, key, hash)).pipe(
      mergeMap((stored) => {
        if (stored) {
          res.status(stored.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(stored.body);
        }
        return next.handle().pipe(
          mergeMap(async (body) => {
            await this.db
              .updateTable('idempotency_keys')
              .set({ response_status: res.statusCode, response_body: JSON.stringify(body ?? null) })
              .where('user_id', '=', userId)
              .where('idem_key', '=', key)
              .execute();
            return body;
          }),
          catchError(async (err) => {
            await this.db.deleteFrom('idempotency_keys').where('user_id', '=', userId).where('idem_key', '=', key).execute();
            throw err;
          }),
        );
      }),
    );
  }

  private async reserve(userId: string, key: string, hash: string): Promise<{ status: number; body: unknown } | null> {
    const ins = await this.db
      .insertInto('idempotency_keys')
      .ignore()
      .values({ user_id: userId, idem_key: key, request_hash: hash, response_status: 0, response_body: 'null' })
      .executeTakeFirst();
    if (Number(ins.numInsertedOrUpdatedRows ?? 0) > 0) return null;
    const row = await this.db
      .selectFrom('idempotency_keys')
      .selectAll()
      .where('user_id', '=', userId)
      .where('idem_key', '=', key)
      .executeTakeFirstOrThrow();
    if (row.request_hash !== hash) throw Errors.conflict('IDEMPOTENCY_MISMATCH', 'Idempotency-Key reutilizada com outro conteúdo.');
    if (row.response_status === 0) throw Errors.conflict('IDEMPOTENCY_IN_PROGRESS', 'Requisição idêntica ainda em processamento.');
    return { status: row.response_status, body: row.response_body };
  }
}
