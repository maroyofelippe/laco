import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { Kysely, MysqlDialect } from 'kysely';
import { createPool, type PoolOptions } from 'mysql2';
import { config } from '../config';
import type { Database } from './types';

export const DB = Symbol('DB');
export const InjectDb = () => Inject(DB);
export type Db = Kysely<Database>;

export function poolOptions(overrides: Partial<PoolOptions> = {}): PoolOptions {
  return {
    ...(config.db.socketPath ? { socketPath: config.db.socketPath } : { host: config.db.host, port: config.db.port }),
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    connectionLimit: 10,
    timezone: 'Z',
    dateStrings: true, // DATE/DATETIME como string: evita deslocamento de fuso
    decimalNumbers: false, // DECIMAL como string: sem perda de precisão
    charset: 'utf8mb4',
    // DATETIME/TIMESTAMP (gravados em UTC) saem como ISO 8601: '2026-10-26T14:02:11.000Z'
    typeCast: (field, next) => {
      if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
        const v = field.string();
        return v ? `${v.replace(' ', 'T')}${v.includes('.') ? '' : '.000'}Z` : null;
      }
      return next();
    },
    ssl: config.db.sslOptions,
    ...overrides,
  };
}

export function createDb(overrides: Partial<PoolOptions> = {}): Db {
  const pool = createPool(poolOptions(overrides));
  // Sessão em UTC: CURRENT_TIMESTAMP e os DATETIME gravados pela aplicação ficam no mesmo fuso
  pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
  return new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
}

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => createDb() }],
  exports: [DB],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly db: Db) {}
  async onModuleDestroy() {
    await this.db.destroy();
  }
}
