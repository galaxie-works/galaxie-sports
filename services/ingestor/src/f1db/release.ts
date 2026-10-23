/**
 * Release fixado do F1DB (https://github.com/f1db/f1db, CC BY 4.0): baixa o `f1db-sqlite.zip` uma vez para um
 * diretório fora do repositório, confere o sha256 publicado e extrai o `f1db.db`.
 *
 * Para atualizar a versão: troque `F1DB_RELEASE` e o hash pelo `checksums_sha256.txt` do release novo
 * (conferido à mão, de propósito: a versão só muda num PR).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const F1DB_RELEASE = {
  version: 'v2026.17.0',
  asset: 'f1db-sqlite.zip',
  sha256: '7de55fe0660aae51604c036720b5f02a15e5224b8e66044080e4a657aea88af6',
} as const;

const USER_AGENT = 'GalaxieSports-Ingestor/1.0';

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Diretório dos releases: `F1DB_DIR` ou `~/.galaxie/f1db` (fora do repo). */
export function f1dbDir(override?: string): string {
  return override ?? process.env.F1DB_DIR ?? join(homedir(), '.galaxie', 'f1db');
}

/**
 * Garante o `f1db.db` do release em `<dir>/<versão>/`: baixa o zip (se faltar), confere o sha256 e extrai.
 * Devolve o caminho do banco SQLite.
 */
export async function ensureRelease(
  dir: string,
  release: { version: string; asset: string; sha256: string } = F1DB_RELEASE,
  log: (msg: string) => void = () => {},
): Promise<string> {
  const target = join(dir, release.version);
  const zipPath = join(target, release.asset);
  const dbPath = join(target, 'f1db.db');
  await mkdir(target, { recursive: true });
  if (!existsSync(zipPath)) {
    const url = `https://github.com/f1db/f1db/releases/download/${release.version}/${release.asset}`;
    log(`baixando ${url}`);
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
    if (!res.ok) throw new Error(`F1DB: download falhou (${res.status}) em ${url}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (sha256(body) !== release.sha256)
      throw new Error(`F1DB: sha256 do ${release.asset} não confere com o release ${release.version}`);
    await writeFile(`${zipPath}.part`, body);
    await rename(`${zipPath}.part`, zipPath);
  }
  const zip = await readFile(zipPath);
  if (sha256(zip) !== release.sha256)
    throw new Error(`F1DB: ${zipPath} não confere com o sha256 do release ${release.version}`);
  if (!existsSync(dbPath)) {
    await writeFile(`${dbPath}.part`, unzipEntry(zip, 'f1db.db'));
    await rename(`${dbPath}.part`, dbPath);
    log(`extraído ${dbPath}`);
  }
  return dbPath;
}

/** Lê uma entrada de um zip (armazenada ou deflate), pelo diretório central. */
export function unzipEntry(zip: Buffer, name: string): Buffer {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--)
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('zip: fim do diretório central não encontrado');
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: diretório central inválido');
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entryName = zip.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('zip: cabeçalho local inválido');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      const out = method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : null;
      if (!out) throw new Error(`zip: método de compressão ${method} não suportado`);
      if (out.length !== size) throw new Error(`zip: tamanho de ${name} não confere`);
      return out;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: ${name} não está no arquivo`);
}
