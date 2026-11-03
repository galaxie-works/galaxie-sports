/**
 * Pacote do acervo fora do contêiner: `s3://<bucket>/<chave>.tgz` (ou um `.tgz`/pasta local) vira uma pasta num
 * diretório temporário do próprio processo, que some no fim. Assim a importação não depende de `docker compose cp`
 * para o `/tmp` do ingestor nem de `chmod`: o pacote sobe uma vez para o S3 (`aws s3 cp`, ou o painel) e qualquer
 * contêiner avulso, worker ou máquina de dev o lê de lá.
 *
 * O `.tgz` é entrada não confiável: a extração aceita só arquivos e pastas comuns, recusa caminho absoluto, `..`,
 * links e entrada fora da pasta de destino, e tem teto de tamanho e de arquivos.
 */
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface S3Uri {
  bucket: string;
  key: string;
}

/** `s3://bucket/a/b.tgz` → `{ bucket, key }`; null se não é um endereço s3:// válido. */
export function parseS3Uri(uri: string): S3Uri | null {
  const m = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,62})\/(.+)$/i.exec(uri.trim());
  if (!m || m[2]!.split('/').some((p) => p === '..' || p === '')) return null;
  return { bucket: m[1]!, key: m[2]! };
}

export const formatS3Uri = (u: S3Uri) => `s3://${u.bucket}/${u.key}`;

/** Onde o pacote e o manifesto moram: o S3 da stack em produção, um falso nos testes. */
export interface PackageStore {
  /** Grava o objeto em `dest`. false: o objeto não existe. */
  download(uri: S3Uri, dest: string): Promise<boolean>;
  upload(uri: S3Uri, body: Uint8Array, contentType: string): Promise<void>;
  exists(uri: S3Uri): Promise<boolean>;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/** S3 compatível (RustFS da stack), com as credenciais de S3_ENDPOINT, S3_ACCESS_KEY e S3_SECRET_KEY. */
export class S3PackageStore implements PackageStore {
  constructor(private readonly s3: S3Client) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): S3PackageStore {
    const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION } = env;
    if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY)
      throw new Error('Defina S3_ENDPOINT, S3_ACCESS_KEY e S3_SECRET_KEY (.env) para ler o pacote do S3.');
    return new S3PackageStore(
      new S3Client({
        endpoint: S3_ENDPOINT,
        region: S3_REGION ?? 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
        // 30 s sem dado no socket derruba a tentativa (o SDK tenta de novo); o download em si pode levar minutos
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
      }),
    );
  }

  async download(uri: S3Uri, dest: string): Promise<boolean> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: uri.bucket, Key: uri.key }));
      if (!res.Body) return false;
      await pipeline(res.Body as Readable, createWriteStream(dest));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async upload(uri: S3Uri, body: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: uri.bucket, Key: uri.key, Body: body, ContentType: contentType }),
    );
  }

  async exists(uri: S3Uri): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: uri.bucket, Key: uri.key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  close(): void {
    this.s3.destroy();
  }
}

/** Objetos em memória (testes). */
export class InMemoryPackageStore implements PackageStore {
  readonly objects = new Map<string, Uint8Array>();

  async download(uri: S3Uri, dest: string): Promise<boolean> {
    const body = this.objects.get(formatS3Uri(uri));
    if (!body) return false;
    await pipeline(Readable.from([Buffer.from(body)]), createWriteStream(dest));
    return true;
  }

  async upload(uri: S3Uri, body: Uint8Array): Promise<void> {
    this.objects.set(formatS3Uri(uri), new Uint8Array(body));
  }

  async exists(uri: S3Uri): Promise<boolean> {
    return this.objects.has(formatS3Uri(uri));
  }
}

// ── extração do .tgz ─────────────────────────────────────────────────────────────────────────────

export interface ExtractLimits {
  /** Soma dos arquivos extraídos. Padrão 2 GiB. */
  maxBytes?: number;
  /** Padrão 100 mil. */
  maxFiles?: number;
}

export interface ExtractReport {
  files: number;
  bytes: number;
  /** Entradas que não são arquivo nem pasta (links, dispositivos): ficam de fora. */
  skipped: string[];
}

const BLOCK = 512;

/** Campo de texto do cabeçalho tar (até o primeiro NUL). */
const text = (b: Buffer, start: number, len: number) => {
  const s = b.subarray(start, start + len);
  const nul = s.indexOf(0);
  return s.subarray(0, nul < 0 ? s.length : nul).toString('utf8');
};

/** Número do cabeçalho: octal em texto, ou binário (base 256) com o bit alto ligado. */
function num(b: Buffer, start: number, len: number): number {
  const s = b.subarray(start, start + len);
  if (s[0]! & 0x80) {
    let n = s[0]! & 0x7f;
    for (let i = 1; i < s.length; i++) n = n * 256 + s[i]!;
    return n;
  }
  const t = text(b, start, len).trim();
  return t ? parseInt(t, 8) : 0;
}

/** Registros pax (`<len> chave=valor\n`): só o `path` importa aqui. */
function paxPath(body: Buffer): string | undefined {
  let path: string | undefined;
  let i = 0;
  while (i < body.length) {
    const space = body.indexOf(0x20, i);
    if (space < 0) break;
    const len = parseInt(body.subarray(i, space).toString('utf8'), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = body.subarray(space + 1, i + len - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0 && record.slice(0, eq) === 'path') path = record.slice(eq + 1);
    i += len;
  }
  return path;
}

/**
 * Caminho seguro dentro de `dest`, ou erro. Recusa absoluto, letra de unidade, `..`, barra invertida e NUL: um
 * pacote não pode escrever fora da pasta temporária.
 */
export function safeEntryPath(dest: string, name: string): string | null {
  if (/^[\\/]|^[a-z]:/i.test(name) || /[\\\0]/.test(name))
    throw new Error(`caminho inseguro no pacote: ${name}`);
  const parts = name.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) throw new Error(`caminho inseguro no pacote: ${name}`);
  if (!parts.length) return null;
  const root = resolve(dest);
  const out = resolve(root, ...parts);
  if (!out.startsWith(root + sep)) throw new Error(`caminho inseguro no pacote: ${name}`);
  return out;
}

/** Extrai um `.tgz` (ustar, GNU com nome longo ou pax) em `dest`, em fluxo, sem carregar o pacote na memória. */
export async function extractTgz(
  file: string,
  dest: string,
  limits: ExtractLimits = {},
): Promise<ExtractReport> {
  const maxBytes = limits.maxBytes ?? 2 * 1024 ** 3;
  const maxFiles = limits.maxFiles ?? 100_000;
  mkdirSync(dest, { recursive: true });
  const report: ExtractReport = { files: 0, bytes: 0, skipped: [] };

  let pending: Buffer = Buffer.alloc(0);
  // estado da entrada corrente
  let remaining = 0; // bytes de dado que faltam
  let padding = 0; // enchimento até o fim do bloco
  let fd: number | null = null;
  let meta: { kind: 'longname' | 'pax'; chunks: Buffer[] } | null = null;
  let nextName: string | undefined; // nome longo (GNU 'L') ou pax `path` da próxima entrada
  let ended = false;

  const closeFd = () => {
    if (fd !== null) closeSync(fd);
    fd = null;
  };

  const onHeader = (h: Buffer) => {
    if (h.every((byte) => byte === 0)) {
      ended = true;
      return;
    }
    const size = num(h, 124, 12);
    const type = String.fromCharCode(h[156]!);
    const magic = text(h, 257, 6);
    const prefix = magic.startsWith('ustar') ? text(h, 345, 155) : '';
    const base = text(h, 0, 100);
    const name = nextName ?? (prefix ? `${prefix}/${base}` : base);
    remaining = size;
    padding = (BLOCK - (size % BLOCK)) % BLOCK;
    if (type === 'L' || type === 'x') {
      meta = { kind: type === 'L' ? 'longname' : 'pax', chunks: [] };
      return;
    }
    nextName = undefined;
    if (type === 'g') return; // pax global: nada que interesse
    if (type === '5' || ((type === '0' || type === '\0') && name.endsWith('/'))) {
      const out = safeEntryPath(dest, name);
      if (out) mkdirSync(out, { recursive: true });
      return;
    }
    if (type !== '0' && type !== '\0' && type !== '7') {
      // link simbólico, link físico, dispositivo...: nunca é criado
      report.skipped.push(name);
      return;
    }
    const out = safeEntryPath(dest, name);
    if (!out) return;
    report.files += 1;
    report.bytes += size;
    if (report.files > maxFiles) throw new Error(`pacote com mais de ${maxFiles} arquivos`);
    if (report.bytes > maxBytes) throw new Error(`pacote passa de ${Math.round(maxBytes / 1024 ** 2)} MiB`);
    mkdirSync(dirname(out), { recursive: true });
    fd = openSync(out, 'wx');
    if (size === 0) closeFd();
  };

  const consume = () => {
    while (!ended) {
      if (remaining > 0) {
        if (!pending.length) return;
        const take = Math.min(remaining, pending.length);
        const chunk = pending.subarray(0, take);
        if (meta) meta.chunks.push(Buffer.from(chunk));
        else if (fd !== null) writeSync(fd, chunk);
        pending = pending.subarray(take);
        remaining -= take;
        if (remaining > 0) return;
        closeFd();
        if (meta) {
          const body = Buffer.concat(meta.chunks);
          nextName = meta.kind === 'longname' ? text(body, 0, body.length) : (paxPath(body) ?? nextName);
          meta = null;
        }
      }
      if (padding > 0) {
        const take = Math.min(padding, pending.length);
        pending = pending.subarray(take);
        padding -= take;
        if (padding > 0) return;
      }
      if (pending.length < BLOCK) return;
      const header = pending.subarray(0, BLOCK);
      pending = pending.subarray(BLOCK);
      onHeader(header);
    }
  };

  try {
    for await (const chunk of createReadStream(file).pipe(createGunzip())) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer);
      consume();
      if (ended) break;
    }
    if (!ended && (remaining > 0 || meta)) throw new Error('pacote truncado (tar incompleto)');
  } finally {
    closeFd();
  }
  return report;
}

/** A pasta do pacote dentro do que foi extraído: a própria, ou a única subpasta, com o acervo.yaml. */
export function packageRoot(dir: string): string {
  if (existsSync(join(dir, 'acervo.yaml'))) return dir;
  const subdirs = readdirSync(dir).filter((n) => !n.startsWith('.') && statSync(join(dir, n)).isDirectory());
  if (subdirs.length === 1 && existsSync(join(dir, subdirs[0]!, 'acervo.yaml')))
    return join(dir, subdirs[0]!);
  throw new Error('pacote sem acervo.yaml (nem na raiz, nem numa pasta única)');
}

export interface OpenedPackage {
  /** Pasta do pacote (com o acervo.yaml). */
  dir: string;
  /** De onde veio: o endereço s3:// ou o caminho local. */
  source: string;
  extract?: ExtractReport;
  /** Apaga o diretório temporário (não faz nada com uma pasta local). */
  cleanup(): void;
}

/** Diretório temporário do processo (some no `cleanup`). */
export function tempDir(prefix = 'galaxie-acervo-'): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Abre o pacote: `s3://bucket/chave.tgz` baixa e extrai num diretório temporário; um `.tgz` local só extrai; uma
 * pasta local é usada como está. `store` só é criado para o s3://.
 */
export async function openPackage(
  spec: string,
  store: () => PackageStore,
  limits?: ExtractLimits,
): Promise<OpenedPackage> {
  const uri = spec.startsWith('s3://') ? parseS3Uri(spec) : undefined;
  if (uri === null) throw new Error(`--pacote inválido: ${spec} (use s3://<bucket>/<chave>.tgz)`);
  if (!uri) {
    const local = resolve(spec);
    if (!existsSync(local)) throw new Error(`pacote não encontrado: ${local}`);
    if (statSync(local).isDirectory()) return { dir: packageRoot(local), source: local, cleanup: () => {} };
  }
  const tmp = tempDir();
  try {
    const archive = uri ? join(tmp.dir, 'pacote.tgz') : resolve(spec);
    if (uri && !(await store().download(uri, archive)))
      throw new Error(`pacote não encontrado no S3: ${formatS3Uri(uri)}`);
    const out = join(tmp.dir, 'pacote');
    const extract = await extractTgz(archive, out, limits);
    // o .tgz baixado não faz mais falta: o disco temporário fica só com a pasta
    if (uri) rmSync(archive, { force: true });
    return {
      dir: packageRoot(out),
      source: uri ? formatS3Uri(uri) : resolve(spec),
      extract,
      cleanup: tmp.cleanup,
    };
  } catch (err) {
    tmp.cleanup();
    throw err;
  }
}
