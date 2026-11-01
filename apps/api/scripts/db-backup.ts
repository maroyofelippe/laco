/**
 * Backup lógico do MySQL local com mysqldump, compactado em gzip.
 *   npm run db:backup                    → backups/laco-AAAAMMDD-HHMMSS.sql.gz
 * Mantém os últimos BACKUP_KEEP arquivos (padrão 14). Consistente sem travar a API
 * (--single-transaction, InnoDB). Usa o usuário de migrações via arquivo de opções temporário.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { config } from '../src/config';
import { ROOT } from './lib/env-file';
import { findTool, withOptionFile } from './lib/mysql-tools';

async function main() {
  const dir = process.env.BACKUP_DIR || join(ROOT, 'backups');
  const keep = Number(process.env.BACKUP_KEEP ?? 14);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(dir, `${config.db.database}-${stamp}.sql.gz`);
  const dump = findTool('mysqldump');

  await withOptionFile(
    { user: config.db.migrationUser, password: config.db.migrationPassword, host: config.db.host, port: config.db.port, socket: config.db.socketPath, ssl: config.db.ssl, sslCa: config.db.sslCaPath },
    async (optFile) => {
      // Sem --databases: o dump não traz CREATE DATABASE/USE, então pode ser restaurado em qualquer
      // banco (ex.: backup do "laco" local restaurado em "defaultdb" no Aiven).
      const child = spawn(dump, [
        `--defaults-extra-file=${optFile}`, '--single-transaction', '--quick', '--routines', '--triggers', '--events',
        '--no-tablespaces', '--set-gtid-purged=OFF', '--default-character-set=utf8mb4', '--hex-blob', config.db.database,
      ]);
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      const done = new Promise<number>((res) => child.on('close', res));
      await pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(file, { mode: 0o600 }));
      const code = await done;
      if (code !== 0) {
        rmSync(file, { force: true });
        throw new Error(`mysqldump falhou (código ${code}): ${stderr.trim()}`);
      }
    },
  );
  console.log(`Backup criado: ${file} (${(statSync(file).size / 1024).toFixed(1)} KB)`);

  const old = readdirSync(dir).filter((f) => f.startsWith(`${config.db.database}-`) && f.endsWith('.sql.gz')).sort().reverse().slice(keep);
  for (const f of old) rmSync(join(dir, f));
  if (old.length) console.log(`${old.length} backup(s) antigo(s) removido(s) (mantendo ${keep}).`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
