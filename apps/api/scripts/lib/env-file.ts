import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(__dirname, '..', '..');
export const ENV_PATH = join(ROOT, '.env');

/** Garante que .env exista (copiado de .env.example) e devolve leitura/escrita de chaves. */
export function envFile() {
  if (!existsSync(ENV_PATH)) copyFileSync(join(ROOT, '.env.example'), ENV_PATH);
  let text = readFileSync(ENV_PATH, 'utf8');
  const get = (k: string) => {
    const m = text.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m ? m[1].replace(/^"(.*)"$/, '$1').trim() : undefined;
  };
  const set = (k: string, v: string) => {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${text.trimEnd()}\n${line}\n`;
  };
  const save = () => writeFileSync(ENV_PATH, text);
  return { get, set, save };
}

export const ok = (m: string) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
export const warn = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
export const fail = (m: string) => console.log(`  \x1b[31m✖\x1b[0m ${m}`);
