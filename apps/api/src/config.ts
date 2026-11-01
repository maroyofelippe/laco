import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

const pem = (v: string) => v.replace(/\\n/g, '\n');

/**
 * CA do servidor MySQL (ex.: ca.pem do Aiven). DB_SSL_CA aceita o caminho do arquivo
 * (relativo à pasta da API ou ao diretório atual) ou o próprio PEM, com \n literais.
 */
function resolveDbCa(): { path?: string; pem?: string } {
  const v = process.env.DB_SSL_CA?.trim();
  if (!v) return {};
  if (v.includes('BEGIN CERTIFICATE')) return { pem: pem(v) };
  const path = [resolvePath(v), resolvePath(__dirname, '..', v), resolvePath(__dirname, '../../..', v)].find((p) => existsSync(p));
  if (!path) throw new Error(`DB_SSL_CA aponta para um arquivo inexistente: ${v}`);
  return { path, pem: readFileSync(path, 'utf8') };
}
const dbCa = resolveDbCa();
const dbSsl = process.env.DB_SSL === 'true';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 3001),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Prefixo do campo `type` dos erros (RFC 9457). URN até o domínio oficial do Laço ser definido. */
  /** Arquivos (extratos PDF, fotos de notas). Local nesta fase; mesma interface servirá para S3/MinIO. */
  storageDir: process.env.STORAGE_DIR || require('node:path').join(process.cwd(), 'storage'),
  problemTypeBase: process.env.PROBLEM_TYPE_BASE || 'urn:laco:erro:',
  /**
   * MySQL instalado localmente (sem Docker). Dois usuários com privilégio mínimo:
   * - app (DB_USER): só SELECT/INSERT/UPDATE/DELETE — usado pela API em execução;
   * - migrator (DB_MIGRATION_USER): DDL — usado apenas por db:migrate / db:reset / testes.
   * DB_SOCKET (opcional) conecta pelo socket Unix em vez de TCP (Linux/macOS).
   */
  db: {
    host: req('DB_HOST', '127.0.0.1'),
    port: Number(process.env.DB_PORT ?? 3306),
    socketPath: process.env.DB_SOCKET || undefined,
    user: req('DB_USER', 'laco_app'),
    password: process.env.DB_PASSWORD ?? '',
    database: req('DB_NAME', 'laco'),
    testDatabase: process.env.DB_TEST_NAME || 'laco_test',
    ssl: dbSsl,
    /** Caminho do arquivo da CA (para mysql/mysqldump); indefinido se DB_SSL_CA for o PEM em linha. */
    sslCaPath: dbCa.path,
    /** Opções TLS prontas para o mysql2: valida o certificado e usa a CA própria quando informada. */
    sslOptions: dbSsl ? { rejectUnauthorized: true, ...(dbCa.pem ? { ca: dbCa.pem } : {}) } : undefined,
    migrationUser: process.env.DB_MIGRATION_USER || 'laco_migrator',
    migrationPassword: process.env.DB_MIGRATION_PASSWORD ?? '',
  },
  jwt: {
    issuer: req('JWT_ISSUER', 'laco-api'),
    audience: req('JWT_AUDIENCE', 'laco'),
    accessTtl: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    get privateKey() {
      return pem(req('JWT_PRIVATE_KEY'));
    },
    get publicKey() {
      return pem(req('JWT_PUBLIC_KEY'));
    },
  },
};
