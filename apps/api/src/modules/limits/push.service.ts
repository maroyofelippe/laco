import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectDb, type Db } from '../../db/database';

const PER_LIMIT_HOURS = 6;
const PER_USER_DAY = 5;

/**
 * Envio de push (FCM). Na fase local o envio é simulado (log); a regra anti-excesso
 * já é real: 1 push por limite a cada 6 h e no máximo 5 por usuário por dia.
 * Para produção: firebase-admin com conta de serviço e payload só de dados
 * { type: 'ALERT', familyId, alertId, seq } (sem valores).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');
  constructor(@InjectDb() private readonly db: Db) {}

  async notifyAlert(alert: { id: string; family_id: string; limit_id: string; seq: string | number }, userIds: string[]) {
    for (const userId of userIds) {
      const recentForLimit = await this.db
        .selectFrom('alert_receipts as r')
        .innerJoin('alerts as a', 'a.id', 'r.alert_id')
        .select('r.alert_id')
        .where('r.user_id', '=', userId)
        .where('a.limit_id', '=', alert.limit_id)
        .where('r.push_sent_at', '>', sql<string>`NOW(3) - INTERVAL ${PER_LIMIT_HOURS} HOUR`)
        .executeTakeFirst();
      const today = await this.db
        .selectFrom('alert_receipts')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('user_id', '=', userId)
        .where('push_sent_at', '>', sql<string>`NOW(3) - INTERVAL 1 DAY`)
        .executeTakeFirstOrThrow();
      if (recentForLimit || Number(today.n) >= PER_USER_DAY) continue; // fica só na lista do app

      const devices = await this.db.selectFrom('devices').select('fcm_token').where('user_id', '=', userId).where('fcm_token', 'is not', null).execute();
      for (const d of devices) {
        this.logger.log(`[FCM simulado] token=${d.fcm_token?.slice(0, 12)}… data=${JSON.stringify({ type: 'ALERT', familyId: alert.family_id, alertId: alert.id, seq: String(alert.seq) })}`);
      }
      await this.db
        .updateTable('alert_receipts')
        .set({ push_sent_at: sql`NOW(3)` as never })
        .where('alert_id', '=', alert.id)
        .where('user_id', '=', userId)
        .execute();
    }
  }
}
