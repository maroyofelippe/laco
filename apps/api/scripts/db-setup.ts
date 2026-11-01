/**
 * Prepara um MySQL 8 INSTALADO LOCALMENTE (sem Docker) para o Laço.
 * Idempotente: pode rodar de novo a qualquer momento.
 *
 *   npm run db:setup                  conecta como root (pede a senha) e cria tudo
 *   npm run db:setup -- --print-sql   só imprime o SQL (para rodar com `sudo mysql` ou no Workbench)
 *
 * Cria:
 *   - bancos laco e laco_test (utf8mb4)
 *   - laco_app       SELECT, INSERT, UPDATE, DELETE   → usado pela API
 *   - laco_migrator  todos os privilégios nos 2 bancos → usado só por migrações/testes
 * As senhas são geradas e gravadas no .env se estiverem vazias.
 *
 * Variáveis opcionais (ambiente ou .env): MYSQL_ADMIN_USER (padrão root; Aiven: avnadmin), MYSQL_ADMIN_PASSWORD, MYSQL_ADMIN_SOCKET.
 * Com DB_HOST remoto, os usuários são criados com host '%' e a conexão usa DB_SSL/DB_SSL_CA.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';
import { createConnection, format } from 'mysql2/promise';
import { envFile, fail, ok, warn } from './lib/env-file';

const IDENT = /^[A-Za-z0-9_]{1,32}$/;
const LOCAL_HOSTS = ['localhost', '127.0.0.1']; // socket/TCP local; nunca '%' (sem acesso de outras máquinas)
const REMOTE_HOSTS = ['%']; // MySQL gerenciado (ex.: Aiven): o IP de origem das conexões não é fixo

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(question)) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function buildSql(c: { hosts: string[]; db: string; testDb: string; appUser: string; appPw: string; migUser: string; migPw: string }) {
  for (const v of [c.db, c.testDb, c.appUser, c.migUser]) if (!IDENT.test(v)) throw new Error(`Nome inválido: ${v}`);
  const sql: string[] = [];
  for (const db of [c.db, c.testDb]) sql.push(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`);
  for (const host of c.hosts) {
    for (const [user, pw] of [[c.appUser, c.appPw], [c.migUser, c.migPw]]) {
      sql.push(format(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?;`, [user, host, pw]));
      sql.push(format(`ALTER USER ?@? IDENTIFIED BY ?;`, [user, host, pw]));
    }
    for (const db of [c.db, c.testDb]) {
      sql.push(format(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${db}\`.* TO ?@?;`, [c.appUser, host]));
      sql.push(format(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO ?@?;`, [c.migUser, host]));
    }
  }
  return sql;
}

const socketIsSet = (v?: string) => !!v;

function loadCa(v?: string): string | undefined {
  if (!v) return undefined;
  if (v.includes('BEGIN CERTIFICATE')) return v.replace(/\\n/g, '\n');
  const path = [resolvePath(v), resolvePath(__dirname, '..', v), resolvePath(__dirname, '../../..', v)].find((p) => existsSync(p));
  if (!path) throw new Error(`DB_SSL_CA aponta para um arquivo inexistente: ${v}`);
  return readFileSync(path, 'utf8');
}

async function main() {
  const printOnly = process.argv.includes('--print-sql');
  const env = envFile();
  const gen = () => randomBytes(18).toString('base64url');

  const c = {
    db: env.get('DB_NAME') || 'laco',
    testDb: env.get('DB_TEST_NAME') || 'laco_test',
    appUser: env.get('DB_USER') || 'laco_app',
    appPw: env.get('DB_PASSWORD') || '',
    migUser: env.get('DB_MIGRATION_USER') || 'laco_migrator',
    migPw: env.get('DB_MIGRATION_PASSWORD') || '',
  };
  let changed = false;
  if (!c.appPw) { c.appPw = gen(); env.set('DB_PASSWORD', c.appPw); changed = true; }
  if (!c.migPw) { c.migPw = gen(); env.set('DB_MIGRATION_PASSWORD', c.migPw); changed = true; }
  if (changed) env.save();

  const dbHost = env.get('DB_HOST') || '127.0.0.1';
  const remote = !socketIsSet(env.get('DB_SOCKET')) && ![...LOCAL_HOSTS, '::1'].includes(dbHost);
  const sql = buildSql({ ...c, hosts: remote ? REMOTE_HOSTS : LOCAL_HOSTS });
  if (printOnly) {
    console.log(`-- Laço: preparação do MySQL local (gerado por npm run db:setup -- --print-sql)\n-- Rode como administrador, ex.: sudo mysql < setup.sql\n${sql.join('\n')}`);
    if (changed) console.error('Senhas novas gravadas no .env.');
    return;
  }

  console.log('\nLaço · preparação do MySQL local\n');
  const adminUser = process.env.MYSQL_ADMIN_USER || env.get('MYSQL_ADMIN_USER') || 'root';
  const socket = process.env.MYSQL_ADMIN_SOCKET || env.get('DB_SOCKET') || undefined;
  let adminPw = process.env.MYSQL_ADMIN_PASSWORD ?? env.get('MYSQL_ADMIN_PASSWORD');
  if (adminPw === undefined && process.stdin.isTTY) adminPw = await promptHidden(`Senha do usuário administrador "${adminUser}" do MySQL (Enter se não tiver): `);

  const host = dbHost;
  const port = Number(env.get('DB_PORT') || 3306);
  const ssl = env.get('DB_SSL') === 'true' ? { rejectUnauthorized: true, ca: loadCa(env.get('DB_SSL_CA')) } : undefined;
  let conn;
  try {
    conn = await createConnection({ ...(socket ? { socketPath: socket } : { host, port }), user: adminUser, password: adminPw ?? '', ssl, multipleStatements: false });
  } catch (e) {
    const err = e as { code?: string; message: string };
    fail(`Não conectou como ${adminUser} em ${socket ?? `${host}:${port}`}: ${err.code ?? err.message}`);
    if (err.code === 'ECONNREFUSED') warn('O serviço do MySQL está parado? Windows: services.msc → MySQL84 · macOS: brew services start mysql@8.4 · Linux: sudo systemctl start mysql');
    if (err.code?.startsWith('ER_ACCESS_DENIED')) warn('No Ubuntu/Debian o root usa auth_socket. Use: npm run db:setup -- --print-sql > setup.sql && sudo mysql < setup.sql');
    process.exit(1);
  }
  const [[v]] = (await conn.query('SELECT VERSION() AS v, @@character_set_server AS cs')) as unknown as [[{ v: string; cs: string }]];
  const [major, minor] = v.v.split('.').map(Number);
  if (major < 8) {
    fail(`MySQL ${v.v} encontrado; é necessário 8.0 ou superior (recomendado 8.4 LTS).`);
    process.exit(1);
  }
  ok(`Conectado ao MySQL ${v.v}${major === 8 && minor < 4 ? ' (funciona; 8.4 LTS é o recomendado)' : ''}`);
  for (const stmt of sql) await conn.query(stmt);
  await conn.end();
  ok(`Bancos: ${c.db}, ${c.testDb}`);
  ok(`Usuário da API: ${c.appUser} (somente leitura/escrita de dados)`);
  ok(`Usuário de migrações: ${c.migUser}`);
  if (changed) ok('Senhas geradas e gravadas no .env (não versionado)');
  if (v.cs !== 'utf8mb4') warn(`character_set_server = ${v.cs}. Os bancos foram criados em utf8mb4, mas veja infra/mysql/my.cnf.example.`);
  console.log('\nPróximos passos: npm run db:migrate && npm run db:seed && npm run db:doctor\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
