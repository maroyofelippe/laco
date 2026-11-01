/**
 * Executor de migrações SQL versionadas (db/migrations/NNN_nome.sql).
 * Registra o que já rodou em schema_migrations com checksum, e recusa
 * migrações já aplicadas que tenham sido alteradas.
 *   npm run db:migrate            aplica as pendentes
 *   npm run db:migrate -- --reset apaga e recria o banco (somente fora de produção)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'mysql2/promise';
import { config } from '../config';

function migrationsDir(): string {
  const candidates = [join(__dirname, '../../db/migrations'), join(__dirname, '../db'), join(process.cwd(), 'db/migrations')];
  const found = candidates.find((d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith('.sql')));
  if (!found) throw new Error('Pasta de migrações não encontrada');
  return found;
}

export async function migrate(opts: { reset?: boolean; database?: string; silent?: boolean } = {}) {
  const database = opts.database ?? config.db.database;
  const log = (m: string) => !opts.silent && console.log(m);
  // Migrações usam o usuário com DDL; a API em execução usa o usuário de aplicação (só DML)
  const conn = await createConnection({
    ...(config.db.socketPath ? { socketPath: config.db.socketPath } : { host: config.db.host, port: config.db.port }),
    user: config.db.migrationUser, password: config.db.migrationPassword,
    multipleStatements: true, ssl: config.db.sslOptions,
  }).catch((e: { code?: string; message: string }) => {
    throw new Error(`Não foi possível conectar ao MySQL (${config.db.host}) como ${config.db.migrationUser} (${e.code ?? e.message}). Rode "npm run db:setup" e confira o .env.`);
  });
  try {
    if (opts.reset) {
      if (config.isProd) throw new Error('--reset não é permitido em produção');
      // Apaga as tabelas (não o banco): os GRANTs do usuário de aplicação continuam valendo
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
      const [tables] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [database]);
      const names = (tables as { t: string }[]).map((r) => `\`${database}\`.\`${r.t}\``);
      if (names.length) await conn.query(`SET FOREIGN_KEY_CHECKS = 0; DROP TABLE IF EXISTS ${names.join(', ')}; SET FOREIGN_KEY_CHECKS = 1;`);
      log(`Tabelas de ${database} removidas`);
    }
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.query(`USE \`${database}\``);
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`);
    const [rows] = await conn.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map((rows as { version: string; checksum: string }[]).map((r) => [r.version, r.checksum]));
    const dir = migrationsDir();
    const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    let count = 0;
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prev = applied.get(file);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migração ${file} foi alterada depois de aplicada`);
        continue;
      }
      log(`Aplicando ${file}...`);
      await conn.query(sql); // DDL no MySQL não é transacional: mantenha migrações pequenas
      await conn.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file, checksum]);
      count++;
    }
    log(count ? `${count} migração(ões) aplicada(s)` : 'Banco já está atualizado');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrate({ reset: process.argv.includes('--reset') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
