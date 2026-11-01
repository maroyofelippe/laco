import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, type Db } from '../db/database';
import type { RequestMeta } from './context';

export interface AuditEntry {
  familyId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: unknown;
  meta?: RequestMeta;
}

const SENSITIVE = /password|token|hash|secret/i;

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(@InjectDb() private readonly db: Db) {}

  /** Nunca derruba a operação principal; remove campos sensíveis do diff. */
  async log(e: AuditEntry, trx: Db = this.db) {
    try {
      await trx
        .insertInto('audit_logs')
        .values({
          family_id: e.familyId ?? null,
          actor_user_id: e.actorUserId ?? null,
          action: e.action,
          entity_type: e.entityType,
          entity_id: e.entityId ?? null,
          diff: e.diff === undefined ? null : JSON.stringify(scrub(e.diff)),
          ip: e.meta?.ip ?? null,
          user_agent: e.meta?.userAgent ?? null,
          request_id: e.meta?.requestId ?? null,
        })
        .execute();
    } catch (err) {
      this.logger.warn({ err }, 'Falha ao gravar auditoria');
    }
  }
}

function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SENSITIVE.test(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}
