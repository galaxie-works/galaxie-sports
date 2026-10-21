import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import {
  MediaDenylist,
  mediaStorageKey,
  normalizeMediaUrl,
  systemClock,
  type Clock,
  type MediaDenylistEntry,
} from '@galaxie/apisports-client';
import type { AssetStore, MirrorAsset } from './asset-store.js';
import { imageInfo } from './image-info.js';
import { MediaFetcher } from './media-fetcher.js';
import type { ObjectStore } from './object-store.js';

/** Lê config/assets/denylist.yaml (`denylist: [{ url, reason }]`). */
export async function loadMediaDenylist(path: string): Promise<MediaDenylist> {
  const doc = parse(await readFile(path, 'utf8')) as { denylist?: MediaDenylistEntry[] } | null;
  return new MediaDenylist(doc?.denylist ?? []);
}

export interface AssetMirrorOptions {
  assets: AssetStore;
  objects: ObjectStore;
  fetcher?: MediaFetcher;
  denylist?: MediaDenylist;
  clock?: Clock;
  /** Downloads simultâneos. Padrão 3 — a CDN limita por segundo/minuto. */
  concurrency?: number;
  /** Pausa de cada worker após cada download (ms). Padrão 250. */
  delayMs?: number;
  /** Máximo de assets nesta execução. */
  limit?: number | undefined;
  /** Tenta de novo os marcados como ausentes (404/bloqueados). */
  includeMissing?: boolean;
  /** Interrompe a execução depois de N assets seguidos que esgotaram as tentativas por 429. Padrão 5. */
  abortAfterRateLimited?: number;
  /** Só lista o que seria baixado. */
  dryRun?: boolean;
  onProgress?: (event: MirrorEvent) => void;
}

export type MirrorEvent =
  | { type: 'stored'; asset: MirrorAsset; storageKey: string; bytes: number }
  | { type: 'not_found'; asset: MirrorAsset; httpStatus: number }
  | { type: 'denied'; asset: MirrorAsset; reason: string }
  | { type: 'failed'; asset: MirrorAsset; reason: string }
  | { type: 'aborted'; reason: string };

export interface MirrorReport {
  pending: number;
  stored: number;
  notFound: number;
  denied: number;
  failed: number;
  /** Já espelhados que entraram na lista de bloqueio e foram desvinculados. */
  unlinked: number;
  bytes: number;
  aborted: string | null;
  failures: { url: string; reason: string }[];
  notFoundUrls: string[];
}

/**
 * Asset Mirror (issue #18): pega os assets de core.asset ainda não espelhados, baixa da CDN de mídia
 * (não consome cota da API de dados), grava no bucket S3 e preenche storage_key, sha256, bytes,
 * dimensões e fetched_at. Idempotente: uma segunda execução não baixa nada (404 e bloqueados ficam
 * marcados como ausentes; falhas transitórias continuam pendentes para a próxima vez).
 */
export async function runAssetMirror(options: AssetMirrorOptions): Promise<MirrorReport> {
  const clock = options.clock ?? systemClock;
  const fetcher = options.fetcher ?? new MediaFetcher({ clock });
  const denylist = options.denylist ?? new MediaDenylist();
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const delayMs = options.delayMs ?? 250;
  const abortAfter = options.abortAfterRateLimited ?? 5;
  const emit = options.onProgress ?? (() => {});

  const report: MirrorReport = {
    pending: 0,
    stored: 0,
    notFound: 0,
    denied: 0,
    failed: 0,
    unlinked: 0,
    bytes: 0,
    aborted: null,
    failures: [],
    notFoundUrls: [],
  };

  if (!options.dryRun) report.unlinked = await options.assets.unlink(denylist.urls, new Date(clock.now()));

  const queue = await options.assets.pending({
    limit: options.limit,
    includeMissing: options.includeMissing,
  });
  report.pending = queue.length;
  if (options.dryRun) return report;

  let consecutiveRateLimited = 0;
  let next = 0;

  const handle = async (item: MirrorAsset): Promise<void> => {
    const url = normalizeMediaUrl(item.sourceUrl);
    const key = url && mediaStorageKey(url);
    if (!url || !key) {
      report.failed += 1;
      report.failures.push({ url: item.sourceUrl, reason: 'URL fora da CDN de mídia' });
      emit({ type: 'failed', asset: item, reason: 'URL fora da CDN de mídia' });
      return;
    }
    if (denylist.has(url)) {
      await options.assets.markMissing(item.id, new Date(clock.now()));
      report.denied += 1;
      emit({ type: 'denied', asset: item, reason: denylist.reason(url) ?? '' });
      return;
    }

    const res = await fetcher.get(url);
    if (res.status === 'ok') {
      consecutiveRateLimited = 0;
      const sha256 = createHash('sha256').update(res.body).digest('hex');
      const info = imageInfo(res.body, res.contentType);
      await options.objects.put(key, res.body, info.contentType, sha256);
      await options.assets.markStored(item.id, {
        storageKey: key,
        sha256,
        bytes: res.body.length,
        width: info.width,
        height: info.height,
        fetchedAt: new Date(clock.now()),
      });
      report.stored += 1;
      report.bytes += res.body.length;
      emit({ type: 'stored', asset: item, storageKey: key, bytes: res.body.length });
    } else if (res.status === 'not_found') {
      consecutiveRateLimited = 0;
      await options.assets.markMissing(item.id, new Date(clock.now()));
      report.notFound += 1;
      report.notFoundUrls.push(url);
      emit({ type: 'not_found', asset: item, httpStatus: res.httpStatus });
    } else {
      consecutiveRateLimited = res.rateLimited ? consecutiveRateLimited + 1 : 0;
      report.failed += 1;
      report.failures.push({ url, reason: res.reason });
      emit({ type: 'failed', asset: item, reason: res.reason });
      if (consecutiveRateLimited >= abortAfter && !report.aborted) {
        report.aborted = `A CDN de mídia respondeu 429 em ${consecutiveRateLimited} assets seguidos; execução interrompida — tente mais tarde.`;
        emit({ type: 'aborted', reason: report.aborted });
      }
    }
  };

  const worker = async (): Promise<void> => {
    while (!report.aborted) {
      const item = queue[next++];
      if (!item) return;
      await handle(item);
      if (delayMs > 0) await clock.sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return report;
}
