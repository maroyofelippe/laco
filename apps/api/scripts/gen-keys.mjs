// Gera um par de chaves ES256 (P-256) e grava em .env (cria a partir de .env.example se preciso).
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const examplePath = new URL('../.env.example', import.meta.url);
if (!existsSync(envPath)) copyFileSync(examplePath, envPath);

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n');
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString().replace(/\n/g, '\\n');

let env = readFileSync(envPath, 'utf8');
const set = (k, v) => {
  const line = `${k}="${v}"`;
  env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${env}\n${line}`;
};
set('JWT_PRIVATE_KEY', priv);
set('JWT_PUBLIC_KEY', pub);
writeFileSync(envPath, env);
console.log('Chaves ES256 gravadas em .env');
