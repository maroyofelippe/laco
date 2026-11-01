/**
 * Diagnóstico do MySQL local: conexão, versão, charset, fuso, privilégios mínimos e migrações.
 *   npm run db:doctor
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection, type Connection } from 'mysql2/promise';
import { config } from '../src/config';
import { fail, ok, warn } from './lib/env-file';

let problems = 0;
const bad = (m: string) => { problems++; fail(m); };
const target = config.db.socketPath ? `socket ${config.db.socketPath}` : `${config.db.host}:${config.db.port}`;

async function connect(user: string, password: string, database?: string): Promise<Connection | null> {
  try {
    return await createConnection({ ...(config.db.socketPath ? { socketPath: config.db.socketPath } : { host: config.db.host, port: config.db.port }), user, password, database, ssl: config.db.sslOptions });
  } catch (e) {
    const err = e as { code?: string; message: string };
    bad(`${user} não conectou em ${target}: ${err.code ?? err.message}`);
    if (err.code === 'ECONNREFUSED') warn('Serviço do MySQL parado ou em outra porta (DB_PORT).');
    if (err.code?.startsWith('ER_ACCESS_DENIED')) warn('Senha diferente da do .env? Rode novamente: npm run db:setup');
    if (err.code === 'ER_BAD_DB_ERROR') warn('Banco inexistente. Rode: npm run db:setup && npm run db:migrate');
    return null;
  }
}

async function main() {
  console.log(`\nLaço · diagnóstico do MySQL local (${target})\n`);
  const app = await connect(config.db.user, config.db.password, config.db.database);
  if (app) {
    const [[s]] = (await app.query(`SELECT VERSION() v, @@character_set_server cs, @@collation_server co, @@system_time_zone stz, @@global.time_zone gtz,
      @@sql_mode sm, @@local_infile li, @@bind_address ba`).catch(() => app.query(`SELECT VERSION() v, @@character_set_server cs, @@collation_server co, @@system_time_zone stz, @@global.time_zone gtz, @@sql_mode sm, @@local_infile li, NULL ba`))) as unknown as [[Record<string, string | number | null>]];
    const major = Number(String(s.v).split('.')[0]);
    major >= 8 ? ok(`MySQL ${s.v}`) : bad(`MySQL ${s.v}: requer 8.0+`);
    ok(`API conecta como ${config.db.user} no banco ${config.db.database}`);
    const [[dbcs]] = (await app.query('SELECT default_character_set_name cs FROM information_schema.schemata WHERE schema_name = ?', [config.db.database])) as unknown as [[{ cs: string }]];
    dbcs?.cs === 'utf8mb4' ? ok('Banco em utf8mb4') : bad(`Banco em ${dbcs?.cs}: recrie com utf8mb4`);
    if (s.cs !== 'utf8mb4') warn(`character_set_server = ${s.cs} (recomendado utf8mb4; ver infra/mysql/my.cnf.example)`);
    ok(`Fuso do servidor: ${s.gtz === 'SYSTEM' ? `SYSTEM (${s.stz})` : s.gtz} — a API força UTC na sessão`);
    String(s.sm).includes('STRICT_TRANS_TABLES') ? ok('sql_mode estrito') : warn(`sql_mode sem STRICT_TRANS_TABLES: ${s.sm}`);
    if (Number(s.li) === 1) warn('local_infile = ON (recomendado OFF)');
    if (s.ba && !['127.0.0.1', '::1', 'localhost'].includes(String(s.ba))) warn(`bind_address = ${s.ba}: o MySQL aceita conexões de outras máquinas. Para desenvolvimento use 127.0.0.1.`);

    // Privilégio mínimo: o usuário da API NÃO pode alterar estrutura
    try {
      await app.query('CREATE TABLE __doctor_probe (id INT)');
      await app.query('DROP TABLE __doctor_probe');
      bad(`${config.db.user} consegue criar tabelas: restrinja a SELECT/INSERT/UPDATE/DELETE (npm run db:setup corrige)`);
    } catch (e) {
      (e as { code?: string }).code === 'ER_TABLEACCESS_DENIED_ERROR' ? ok(`${config.db.user} sem permissão de DDL (privilégio mínimo)`) : bad(`Teste de DDL falhou de forma inesperada: ${(e as Error).message}`);
    }

    const files = readdirSync(join(__dirname, '..', 'db', 'migrations')).filter((f) => f.endsWith('.sql'));
    const [rows] = (await app.query('SELECT version FROM schema_migrations').catch(() => [[]])) as unknown as [{ version: string }[]];
    const applied = new Set(rows.map((r) => r.version));
    const pending = files.filter((f) => !applied.has(f));
    pending.length ? bad(`Migrações pendentes: ${pending.join(', ')} → npm run db:migrate`) : ok(`Migrações em dia (${files.length})`);
    if (!pending.length) {
      const [[c]] = (await app.query('SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM families) f, (SELECT COUNT(*) FROM transactions) t')) as unknown as [[{ u: number; f: number; t: number }]];
      ok(`Dados: ${c.u} usuário(s), ${c.f} família(s), ${c.t} lançamento(s)${Number(c.u) === 0 ? ' — rode npm run db:seed para dados de demonstração' : ''}`);
    }
    await app.end();
  }

  const mig = await connect(config.db.migrationUser, config.db.migrationPassword);
  if (mig) {
    ok(`Migrações conectam como ${config.db.migrationUser}`);
    const [dbs] = (await mig.query('SHOW DATABASES')) as unknown as [{ Database: string }[]];
    dbs.some((d) => d.Database === config.db.testDatabase) ? ok(`Banco de testes ${config.db.testDatabase} disponível`) : warn(`Banco de testes ${config.db.testDatabase} não existe (npm run db:setup)`);
    await mig.end();
  }

  console.log(problems ? `\n${problems} problema(s) encontrado(s).\n` : '\nTudo certo.\n');
  process.exit(problems ? 1 : 0);
}

main();
