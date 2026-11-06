import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { mediaKindFromUrl, normalizeMediaUrl, systemClock, type Clock } from '@galaxie/apisports-client';
import type { MediaFetchResult, MediaSource } from './media-fetcher.js';

/**
 * Espelho pela máquina local: em vez de a VPS baixar da CDN de mídia, uma máquina local baixa a lista pendente para
 * uma pasta com um manifest, o pacote sobe para a VPS e o mirror roda lá com
 * `--origem-local <pasta>`, lendo o arquivo em vez da rede. A regra (placeholder, 404, bloqueio, dimensões, paleta,
 * o que vai para core.asset) continua toda no `runAssetMirror`; aqui só muda de onde vêm os bytes.
 *
 * Pasta: `<kind>/<caminho da URL>` (ex.: `player/football/players/276.png`) e `manifest.jsonl`, uma linha por URL
 * resolvida: `ok` (arquivo baixado) ou `not_found` (404/410 na CDN). Falha transitória (429, 5xx, rede) não entra no
 * manifest: a próxima execução do download tenta de novo.
 */

export const LOCAL_MANIFEST = 'manifest.jsonl';

/** Uma linha da lista exportada por `assets:pendentes` (só leitura em core.asset). */
export interface PendingListItem {
  id: string;
  kind: string;
  url: string;
}

export type LocalManifestEntry =
  | {
      id: string;
      kind: string;
      url: string;
      status: 'ok';
      /** Relativo à pasta do pacote, sempre com `/`. */
      file: string;
      contentType: string | null;
      bytes: number;
      sha256: string;
    }
  | { id: string; kind: string; url: string; status: 'not_found'; httpStatus: number };

/** Caminho relativo do arquivo no pacote: `<kind>/<caminho da URL normalizada>`. */
export function localMediaPath(kind: string, url: string): string | undefined {
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return undefined;
  const path = new URL(normalized).pathname.replace(/^\/+/, '');
  // o caminho vem do fornecedor: nada de `..` nem segmento vazio saindo da pasta
  if (!path || path.split('/').some((p) => p === '' || p === '.' || p === '..')) return undefined;
  const safeKind = /^[a-z_]+$/.test(kind) ? kind : mediaKindFromUrl(normalized);
  return `${safeKind}/${path}`;
}

/** Lê JSONL ignorando linhas vazias e uma última linha truncada (queda no meio da escrita). */
function parseJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // linha cortada: o item volta a ser baixado na próxima execução
    }
  }
  return out;
}

export function parsePendingList(text: string): PendingListItem[] {
  return parseJsonl<PendingListItem>(text).filter(
    (r) => typeof r.id === 'string' && typeof r.url === 'string' && typeof r.kind === 'string',
  );
}

export async function readLocalManifest(dir: string): Promise<LocalManifestEntry[]> {
  let text: string;
  try {
    text = await readFile(join(dir, LOCAL_MANIFEST), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return parseJsonl<LocalManifestEntry>(text).filter((e) => e.status === 'ok' || e.status === 'not_found');
}

export interface LocalDownloadOptions {
  items: PendingListItem[];
  dir: string;
  fetcher: MediaSource;
  clock?: Clock;
  /** Downloads simultâneos. Padrão 3, como no mirror. */
  concurrency?: number;
  /** Pausa de cada worker depois de cada download (ms). Padrão 250. */
  delayMs?: number;
  limit?: number | undefined;
  /** Interrompe depois de N itens seguidos que esgotaram as tentativas por 429. Padrão 5. */
  abortAfterRateLimited?: number;
  signal?: AbortSignal | undefined;
  onProgress?: (event: LocalDownloadEvent) => void;
}

export type LocalDownloadEvent =
  | { type: 'ok'; item: PendingListItem; bytes: number }
  | { type: 'not_found'; item: PendingListItem }
  | { type: 'failed'; item: PendingListItem; reason: string }
  | { type: 'aborted'; reason: string };

export interface LocalDownloadReport {
  /** Itens da lista. */
  listed: number;
  /** Já resolvidos numa execução anterior (manifest): pulados. */
  skipped: number;
  ok: number;
  notFound: number;
  failed: number;
  bytes: number;
  aborted: string | null;
  failures: { url: string; reason: string }[];
}

/**
 * Baixa a lista pendente para `dir`, retomando pelo manifest: o que já está lá como `ok` ou `not_found` não é baixado
 * de novo. Cada arquivo é gravado (temporário + rename) antes da linha do manifest, então uma queda no meio deixa no
 * máximo um arquivo sem linha, que é baixado de novo.
 */
export async function downloadToLocal(options: LocalDownloadOptions): Promise<LocalDownloadReport> {
  const clock = options.clock ?? systemClock;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const delayMs = options.delayMs ?? 250;
  const abortAfter = options.abortAfterRateLimited ?? 5;
  const emit = options.onProgress ?? (() => {});
  await mkdir(options.dir, { recursive: true });

  const done = new Set((await readLocalManifest(options.dir)).map((e) => normalizeMediaUrl(e.url) ?? e.url));
  const seen = new Set<string>();
  const queue: (PendingListItem & { normalized: string; file: string })[] = [];
  const report: LocalDownloadReport = {
    listed: options.items.length,
    skipped: 0,
    ok: 0,
    notFound: 0,
    failed: 0,
    bytes: 0,
    aborted: null,
    failures: [],
  };
  for (const item of options.items) {
    const normalized = normalizeMediaUrl(item.url);
    const file = normalized && localMediaPath(item.kind, normalized);
    if (!normalized || !file) {
      report.failed += 1;
      report.failures.push({ url: item.url, reason: 'URL fora da CDN de mídia' });
      continue;
    }
    if (done.has(normalized) || seen.has(normalized)) {
      report.skipped += 1;
      continue;
    }
    seen.add(normalized);
    queue.push({ ...item, normalized, file });
  }
  if (options.limit !== undefined) queue.splice(options.limit);

  const manifest = createWriteStream(join(options.dir, LOCAL_MANIFEST), { flags: 'a' });
  const append = (entry: LocalManifestEntry) =>
    new Promise<void>((ok, fail) =>
      manifest.write(`${JSON.stringify(entry)}\n`, (err) => (err ? fail(err) : ok())),
    );

  let consecutiveRateLimited = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (!report.aborted && !options.signal?.aborted) {
      const item = queue[next++];
      if (!item) return;
      try {
        await handle(item);
      } catch (err) {
        // erro de disco ou inesperado: o item fica fora do manifest e volta na próxima execução
        const reason = err instanceof Error ? err.message : String(err);
        report.failed += 1;
        report.failures.push({ url: item.normalized, reason });
        emit({ type: 'failed', item, reason });
      }
      if (delayMs > 0 && !options.signal?.aborted) await clock.sleep(delayMs);
    }
  };
  const handle = async (item: (typeof queue)[number]): Promise<void> => {
    const res = await options.fetcher.get(item.normalized);
    if (res.status === 'ok') {
      consecutiveRateLimited = 0;
      const target = join(options.dir, ...item.file.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(`${target}.part`, res.body);
      await rename(`${target}.part`, target);
      await append({
        id: item.id,
        kind: item.kind,
        url: item.normalized,
        status: 'ok',
        file: item.file,
        contentType: res.contentType ?? null,
        bytes: res.body.length,
        sha256: createHash('sha256').update(res.body).digest('hex'),
      });
      report.ok += 1;
      report.bytes += res.body.length;
      emit({ type: 'ok', item, bytes: res.body.length });
    } else if (res.status === 'not_found') {
      consecutiveRateLimited = 0;
      await append({
        id: item.id,
        kind: item.kind,
        url: item.normalized,
        status: 'not_found',
        httpStatus: res.httpStatus,
      });
      report.notFound += 1;
      emit({ type: 'not_found', item });
    } else {
      consecutiveRateLimited = res.rateLimited ? consecutiveRateLimited + 1 : 0;
      report.failed += 1;
      report.failures.push({ url: item.normalized, reason: res.reason });
      emit({ type: 'failed', item, reason: res.reason });
      if (consecutiveRateLimited >= abortAfter && !report.aborted) {
        report.aborted = `A CDN de mídia respondeu 429 em ${consecutiveRateLimited} itens seguidos; download interrompido — rode de novo mais tarde (retoma pelo manifest).`;
        emit({ type: 'aborted', reason: report.aborted });
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  } finally {
    await new Promise<void>((ok) => manifest.end(ok));
  }
  return report;
}

/**
 * Origem do mirror lida do pacote local (o `fetcher` do `runAssetMirror` com `--origem-local`): responde pelo manifest,
 * sem rede. URL fora do pacote ou arquivo que não confere com o sha256 do manifest vira erro (o asset fica pendente).
 */
export class LocalMediaSource implements MediaSource {
  private constructor(
    private readonly dir: string,
    private readonly entries: Map<string, LocalManifestEntry>,
  ) {}

  static async open(dir: string): Promise<LocalMediaSource> {
    const root = resolve(dir);
    const entries = new Map<string, LocalManifestEntry>();
    for (const e of await readLocalManifest(root)) entries.set(normalizeMediaUrl(e.url) ?? e.url, e);
    return new LocalMediaSource(root, entries);
  }

  /** Ids de core.asset resolvidos no pacote (`ok` e `not_found`): a fila do mirror se limita a eles. */
  ids(): string[] {
    return [...new Set([...this.entries.values()].map((e) => e.id))];
  }

  get size(): number {
    return this.entries.size;
  }

  async get(url: string): Promise<MediaFetchResult> {
    const entry = this.entries.get(normalizeMediaUrl(url) ?? url);
    if (!entry) return { status: 'error', reason: 'fora do pacote local', rateLimited: false, attempts: 1 };
    if (entry.status === 'not_found')
      return { status: 'not_found', httpStatus: entry.httpStatus, attempts: 1 };
    const path = resolve(this.dir, ...entry.file.split('/'));
    const rel = relative(this.dir, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      return {
        status: 'error',
        reason: `caminho fora do pacote: ${entry.file}`,
        rateLimited: false,
        attempts: 1,
      };
    }
    let body: Uint8Array;
    try {
      body = new Uint8Array(await readFile(path));
    } catch (err) {
      return {
        status: 'error',
        reason: `arquivo do pacote: ${(err as Error).message}`,
        rateLimited: false,
        attempts: 1,
      };
    }
    if (createHash('sha256').update(body).digest('hex') !== entry.sha256) {
      return {
        status: 'error',
        reason: `arquivo do pacote não confere com o manifest: ${entry.file}`,
        rateLimited: false,
        attempts: 1,
      };
    }
    return { status: 'ok', body, contentType: entry.contentType ?? undefined, attempts: 1 };
  }
}
