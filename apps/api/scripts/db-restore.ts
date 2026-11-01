/**
 * Restaura um backup gerado por db:backup no MySQL local. SUBSTITUI os dados atuais.
 *   npm run db:restore -- backups/laco-20261026-190000.sql.gz --yes
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { config } from '../src/config';
import { findTool, withOptionFile } from './lib/mysql-tools';

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file || !existsSync(file)) throw new Error('Informe o arquivo: npm run db:restore -- <arquivo.sql.gz> --yes');
  if (!process.argv.includes('--yes')) throw new Error(`Isto substitui os dados de "${config.db.database}". Repita com --yes para confirmar.`);
  if (config.isProd && !process.argv.includes('--force')) throw new Error('Em produção, use --force além de --yes.');
  const mysql = findTool('mysql');

  await withOptionFile(
    { user: config.db.migrationUser, password: config.db.migrationPassword, host: config.db.host, port: config.db.port, socket: config.db.socketPath, ssl: config.db.ssl, sslCa: config.db.sslCaPath },
    async (optFile) => {
      // O banco de destino vem do .env (DB_NAME); dumps novos não trazem USE, então caem nele.
      const child = spawn(mysql, [`--defaults-extra-file=${optFile}`, '--default-character-set=utf8mb4', config.db.database]);
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      const done = new Promise<number>((res) => child.on('close', res));
      const input = file.endsWith('.gz') ? [createReadStream(file), createGunzip()] : [createReadStream(file)];
      await pipeline([...input, child.stdin] as never);
      const code = await done;
      if (code !== 0) throw new Error(`mysql falhou (código ${code}): ${stderr.trim()}`);
    },
  );
  console.log(`Backup restaurado em ${config.db.database}. Rode "npm run db:doctor" para conferir.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
