import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { apiResponse, asset, type Database } from '@galaxie/db';

/**
 * Snapshot do raw (#20): NDJSON comprimido com gzip, uma linha por registro.
 *   {"t":"header", ...}  {"t":"raw", ...}×N  {"t":"asset", ...}×M  {"t":"end","raw":N,"assets":M}
 * Restaurar não chama o fornecedor: o ambiente local roda sem APISPORTS_KEY (cliente em modo offline).
 */
export const SNAPSHOT_FORMAT = 'galaxie-raw-snapshot';
export const SNAPSHOT_VERSION = 1;

export interface SnapshotHeader {
  t: 'header';
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  createdAt: string;
  filters: { sport?: string | undefined; since?: string | undefined };
}

export interface SnapshotRaw {
  t: 'raw';
  provider: string;
  sport: string;
  apiVersion: string;
  endpoint: string;
  params: Record<string, string>;
  requestHash: string;
  page: number;
  statusCode: number;
  results: number | null;
  errors: unknown;
  body: unknown;
  bodyHash: string;
  quotaRemaining: number | null;
  fetchedAt: string;
  jobId: string | null;
}

/** Manifesto de assets (URL de origem → objeto no storage); os arquivos em si ficam no object storage. */
export interface SnapshotAsset {
  t: 'asset';
  kind: string;
  sourceUrl: string;
  storageKey: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  fetchedAt: string | null;
}

export interface SnapshotEnd {
  t: 'end';
  raw: number;
  assets: number;
}

export type SnapshotLine = SnapshotHeader | SnapshotRaw | SnapshotAsset | SnapshotEnd;

export interface ExportOptions {
  sport?: string | undefined;
  since?: Date | undefined;
  includeAssets?: boolean | undefined;
}

export interface ExportResult {
  file: string;
  raw: number;
  assets: number;
}

export function defaultSnapshotName(now = new Date()): string {
  return `raw-${now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}.ndjson.gz`;
}

interface RawRow {
  provider: string;
  sport: string;
  api_version: string;
  endpoint: string;
  params: Record<string, string>;
  request_hash: string;
  page: number;
  status_code: number;
  results: number | null;
  errors: unknown;
  body: unknown;
  body_hash: string;
  quota_remaining: number | null;
  /** ISO em UTC (formatado no SQL: o driver do Drizzle não converte timestamptz). */
  fetched_at: string;
  job_id: string | null;
}

interface AssetRow {
  kind: string;
  source_url: string;
  storage_key: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  fetched_at: string | null;
}

/** Exporta raw.api_response (+ manifesto de core.asset) em streaming — não carrega o raw inteiro na memória. */
export async function exportRawSnapshot(
  db: Database,
  file: string,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  await mkdir(dirname(file), { recursive: true });
  const counts = { raw: 0, assets: 0 };
  const sqlc = db.$client;

  const conditions: string[] = ['true'];
  const values: unknown[] = [];
  if (opts.sport) {
    values.push(opts.sport);
    conditions.push(`sport = $${values.length}`);
  }
  if (opts.since) {
    values.push(opts.since.toISOString());
    conditions.push(`fetched_at >= $${values.length}::timestamptz`);
  }

  async function* lines(): AsyncGenerator<string> {
    const header: SnapshotHeader = {
      t: 'header',
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      filters: { sport: opts.sport, since: opts.since?.toISOString() },
    };
    yield `${JSON.stringify(header)}\n`;

    const rawCursor = sqlc
      .unsafe(
        `select provider, sport, api_version, endpoint, params, request_hash, page, status_code, results,
                errors, body, body_hash, quota_remaining, job_id,
                to_char(fetched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as fetched_at
           from raw.api_response where ${conditions.join(' and ')} order by id`,
        values as never[],
      )
      .cursor(200);
    for await (const rows of rawCursor) {
      for (const r of rows as unknown as RawRow[]) {
        const line: SnapshotRaw = {
          t: 'raw',
          provider: r.provider,
          sport: r.sport,
          apiVersion: r.api_version,
          endpoint: r.endpoint,
          params: r.params,
          requestHash: r.request_hash,
          page: r.page,
          statusCode: r.status_code,
          results: r.results,
          errors: r.errors,
          body: r.body,
          bodyHash: r.body_hash,
          quotaRemaining: r.quota_remaining,
          fetchedAt: r.fetched_at,
          jobId: r.job_id,
        };
        counts.raw += 1;
        yield `${JSON.stringify(line)}\n`;
      }
    }

    if (opts.includeAssets ?? true) {
      const assetCursor = sqlc
        .unsafe(
          `select kind, source_url, storage_key, sha256, width, height, bytes,
                  to_char(fetched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as fetched_at
             from core.asset
            -- o acervo customizado tem manifesto próprio (config/assets/acervo) e volta com assets:acervo
            where origin = 'provider'
            order by source_url`,
        )
        .cursor(1000);
      for await (const rows of assetCursor) {
        for (const a of rows as unknown as AssetRow[]) {
          const line: SnapshotAsset = {
            t: 'asset',
            kind: a.kind,
            sourceUrl: a.source_url,
            storageKey: a.storage_key,
            sha256: a.sha256,
            width: a.width,
            height: a.height,
            bytes: a.bytes,
            fetchedAt: a.fetched_at,
          };
          counts.assets += 1;
          yield `${JSON.stringify(line)}\n`;
        }
      }
    }
    const end: SnapshotEnd = { t: 'end', raw: counts.raw, assets: counts.assets };
    yield `${JSON.stringify(end)}\n`;
  }

  await pipeline(Readable.from(lines()), createGzip(), createWriteStream(file));
  return { file, ...counts };
}

export interface ImportSnapshotResult {
  raw: number;
  imported: number;
  duplicates: number;
  assets: number;
}

/** Lê as linhas de um snapshot (gzip) em streaming. */
export async function* readSnapshot(file: string): AsyncGenerator<SnapshotLine> {
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line) as SnapshotLine;
  }
}

/**
 * Restaura um snapshot num banco (local): idempotente — um mesmo corpo para a mesma requisição
 * (request_hash + body_hash) não é inserido duas vezes. Assets: completa storage_key/sha256 sem apagar o que já existe.
 */
export async function importRawSnapshot(db: Database, file: string): Promise<ImportSnapshotResult> {
  const result: ImportSnapshotResult = { raw: 0, imported: 0, duplicates: 0, assets: 0 };
  let header: SnapshotHeader | undefined;
  let end: SnapshotEnd | undefined;
  let rawBatch: SnapshotRaw[] = [];
  let assetBatch: SnapshotAsset[] = [];

  const flushRaw = async () => {
    if (!rawBatch.length) return;
    const batch = rawBatch;
    rawBatch = [];
    const hashes = [...new Set(batch.map((r) => r.requestHash))];
    const existing = (await db.$client.unsafe(
      `select request_hash, body_hash from raw.api_response where request_hash = any($1::text[])`,
      [hashes] as never[],
    )) as unknown as { request_hash: string; body_hash: string }[];
    const seen = new Set(existing.map((e) => `${e.request_hash}|${e.body_hash}`));
    const fresh: (typeof apiResponse.$inferInsert)[] = [];
    for (const r of batch) {
      const key = `${r.requestHash}|${r.bodyHash}`;
      if (seen.has(key)) {
        result.duplicates += 1;
        continue;
      }
      seen.add(key);
      fresh.push({
        provider: r.provider,
        sport: r.sport,
        apiVersion: r.apiVersion,
        endpoint: r.endpoint,
        params: r.params,
        requestHash: r.requestHash,
        page: r.page,
        statusCode: r.statusCode,
        results: r.results,
        errors: r.errors ?? null,
        body: r.body,
        bodyHash: r.bodyHash,
        quotaRemaining: r.quotaRemaining,
        fetchedAt: new Date(r.fetchedAt),
        jobId: r.jobId,
      });
    }
    if (fresh.length) await db.insert(apiResponse).values(fresh);
    result.imported += fresh.length;
  };

  const flushAssets = async () => {
    if (!assetBatch.length) return;
    const batch = assetBatch;
    assetBatch = [];
    await db
      .insert(asset)
      .values(
        batch.map((a) => ({
          kind: a.kind as typeof asset.$inferInsert.kind,
          sourceUrl: a.sourceUrl,
          storageKey: a.storageKey,
          sha256: a.sha256,
          width: a.width,
          height: a.height,
          bytes: a.bytes,
          fetchedAt: a.fetchedAt ? new Date(a.fetchedAt) : null,
        })),
      )
      .onConflictDoUpdate({
        target: asset.sourceUrl,
        set: {
          storageKey: sql`coalesce(${asset.storageKey}, excluded.storage_key)`,
          sha256: sql`coalesce(${asset.sha256}, excluded.sha256)`,
          width: sql`coalesce(${asset.width}, excluded.width)`,
          height: sql`coalesce(${asset.height}, excluded.height)`,
          bytes: sql`coalesce(${asset.bytes}, excluded.bytes)`,
          fetchedAt: sql`coalesce(${asset.fetchedAt}, excluded.fetched_at)`,
        },
      });
    result.assets += batch.length;
  };

  for await (const line of readSnapshot(file)) {
    if (!header) {
      if (line.t !== 'header' || line.format !== SNAPSHOT_FORMAT) {
        throw new Error(`${file} não é um snapshot do raw (${SNAPSHOT_FORMAT}).`);
      }
      if (line.version > SNAPSHOT_VERSION) {
        throw new Error(`Snapshot versão ${line.version} é mais nova que a suportada (${SNAPSHOT_VERSION}).`);
      }
      header = line;
      continue;
    }
    if (line.t === 'raw') {
      result.raw += 1;
      rawBatch.push(line);
      if (rawBatch.length >= 200) await flushRaw();
    } else if (line.t === 'asset') {
      assetBatch.push(line);
      if (assetBatch.length >= 1000) await flushAssets();
    } else if (line.t === 'end') {
      end = line;
    }
  }
  await flushRaw();
  await flushAssets();

  if (!header) throw new Error(`${file} está vazio.`);
  if (!end || end.raw !== result.raw || end.assets !== result.assets) {
    throw new Error(
      `Snapshot incompleto: esperado ${end?.raw ?? '?'} raw e ${end?.assets ?? '?'} assets, lidos ${result.raw} e ${result.assets}.`,
    );
  }
  return result;
}
