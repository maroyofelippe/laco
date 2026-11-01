import { Injectable } from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config';

/**
 * Armazenamento de arquivos. Nesta fase grava em disco local (STORAGE_DIR), fora da pasta
 * pública e sem servir arquivos diretamente: todo download passa pela API com autorização.
 * A interface (put/read/remove por chave) é a mesma que um adaptador S3/MinIO implementará.
 */
@Injectable()
export class StorageService {
  readonly bucket = 'local';
  private readonly root = resolve(config.storageDir);

  private path(key: string) {
    if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes('..')) throw new Error('Chave de arquivo inválida');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Chave fora do diretório de armazenamento');
    return p;
  }

  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600 });
  }

  read(key: string): Readable {
    return createReadStream(this.path(key));
  }

  exists(key: string) {
    return existsSync(this.path(key));
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

/** Confere o tipo real pelo conteúdo (magic bytes), sem confiar na extensão nem no Content-Type. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
