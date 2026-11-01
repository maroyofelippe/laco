import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Localiza mysql/mysqldump no PATH ou nas pastas padrão de instalação (Windows/macOS). */
export function findTool(name: 'mysql' | 'mysqldump'): string {
  const fromEnv = process.env[name === 'mysql' ? 'MYSQL_CLIENT_PATH' : 'MYSQLDUMP_PATH'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [exe], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.split(/\r?\n/)[0].trim();
  const candidates = [
    ...['8.4', '8.0', '9.0', '9.1', '9.2', '9.3', '9.4'].map((v) => `C:\\Program Files\\MySQL\\MySQL Server ${v}\\bin\\${exe}`),
    `/opt/homebrew/opt/mysql@8.4/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/local/opt/mysql@8.4/bin/${name}`, `/usr/local/mysql/bin/${name}`,
  ];
  const found = candidates.find((c) => existsSync(c));
  if (found) return found;
  throw new Error(`"${name}" não encontrado. Adicione a pasta bin do MySQL ao PATH ou defina ${name === 'mysql' ? 'MYSQL_CLIENT_PATH' : 'MYSQLDUMP_PATH'} no .env.`);
}

/**
 * Arquivo de opções temporário (0600) com as credenciais: a senha não aparece na linha
 * de comando nem na lista de processos. Removido ao final.
 */
export async function withOptionFile<T>(opts: { user: string; password: string; host?: string; port?: number; socket?: string; ssl?: boolean; sslCa?: string }, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'laco-'));
  const file = join(dir, 'client.cnf');
  const lines = ['[client]', `user=${opts.user}`, `password="${opts.password.replace(/"/g, '\\"')}"`];
  if (opts.socket) lines.push(`socket=${opts.socket}`);
  else lines.push(`host=${opts.host ?? '127.0.0.1'}`, `port=${opts.port ?? 3306}`, 'protocol=TCP');
  if (opts.ssl && !opts.socket) {
    // Barras normais: no arquivo de opções a contrabarra é caractere de escape
    if (opts.sslCa) lines.push(`ssl-ca="${opts.sslCa.replace(/\\/g, '/')}"`, 'ssl-mode=VERIFY_CA');
    else lines.push('ssl-mode=REQUIRED');
  }
  writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  try {
    return await fn(file); // aguarda o processo terminar antes de apagar o arquivo
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
