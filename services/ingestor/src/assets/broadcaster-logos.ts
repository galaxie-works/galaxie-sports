/**
 * Logos da biblioteca de emissoras (enrich.broadcaster): mesmo mecanismo do Asset Mirror — baixa o
 * arquivo de origem registrado em core.asset (kind `broadcaster_logo`, vindo de
 * config/broadcasters/_logos.yaml pela sincronização da biblioteca), grava no bucket e preenche
 * storage_key, sha256, bytes, dimensões e fetched_at. Só hosts https da allowlist de origens
 * (Wikimedia Commons e sites oficiais listados); idempotente.
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { systemClock, type Clock } from '@galaxie/apisports-client';
import { asset, type Database } from '@galaxie/db';
import { imageInfo } from './image-info.js';
import { MediaFetcher } from './media-fetcher.js';
import type { ObjectStore } from './object-store.js';

/** Prefixo das chaves dos logos de emissoras no bucket. */
export const BROADCASTER_LOGO_PREFIX = 'broadcasters';

/** Hosts aceitos como origem de logo (o YAML é curado; isto evita baixar de qualquer lugar). */
export const LOGO_SOURCE_HOSTS = [/^upload\.wikimedia\.org$/i];

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function logoSourceAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && LOGO_SOURCE_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

/** Chave do objeto: `broadcasters/<sha256[0..16]>.<ext>` (conteúdo endereçável, sem nome de marca). */
export function logoStorageKey(sha256: string, contentType: string): string {
  return `${BROADCASTER_LOGO_PREFIX}/${sha256.slice(0, 16)}.${EXT[contentType] ?? 'bin'}`;
}

export interface LogoMirrorReport {
  pending: number;
  stored: number;
  notFound: number;
  rejected: number;
  failed: number;
  failures: { url: string; reason: string }[];
}

export async function runBroadcasterLogoMirror(options: {
  db: Database;
  objects: ObjectStore;
  fetcher?: MediaFetcher;
  clock?: Clock;
  dryRun?: boolean;
  includeMissing?: boolean;
}): Promise<LogoMirrorReport> {
  const clock = options.clock ?? systemClock;
  const fetcher = options.fetcher ?? new MediaFetcher({ clock, maxRetries: 2 });
  const conds = [eq(asset.kind, 'broadcaster_logo'), isNull(asset.storageKey)];
  if (!options.includeMissing) conds.push(isNull(asset.fetchedAt));
  const queue = await options.db
    .select({ id: asset.id, sourceUrl: asset.sourceUrl })
    .from(asset)
    .where(and(...conds))
    .orderBy(asc(asset.createdAt));
  const report: LogoMirrorReport = {
    pending: queue.length,
    stored: 0,
    notFound: 0,
    rejected: 0,
    failed: 0,
    failures: [],
  };
  if (options.dryRun) return report;
  for (const item of queue) {
    const now = new Date(clock.now());
    if (!logoSourceAllowed(item.sourceUrl)) {
      report.rejected++;
      report.failures.push({ url: item.sourceUrl, reason: 'origem fora da allowlist de logos' });
      await options.db.update(asset).set({ fetchedAt: now }).where(eq(asset.id, item.id));
      continue;
    }
    const res = await fetcher.get(item.sourceUrl);
    if (res.status === 'ok') {
      const sha256 = createHash('sha256').update(res.body).digest('hex');
      const info = imageInfo(res.body, res.contentType);
      if (!info.contentType.startsWith('image/')) {
        report.failed++;
        report.failures.push({ url: item.sourceUrl, reason: `conteúdo não é imagem (${info.contentType})` });
        continue;
      }
      const key = logoStorageKey(sha256, info.contentType);
      await options.objects.put(key, res.body, info.contentType, sha256);
      await options.db
        .update(asset)
        .set({
          storageKey: key,
          sha256,
          bytes: res.body.length,
          width: info.width,
          height: info.height,
          fetchedAt: now,
        })
        .where(eq(asset.id, item.id));
      report.stored++;
    } else if (res.status === 'not_found') {
      await options.db.update(asset).set({ fetchedAt: now }).where(eq(asset.id, item.id));
      report.notFound++;
    } else {
      report.failed++;
      report.failures.push({ url: item.sourceUrl, reason: res.reason });
    }
    await clock.sleep(500);
  }
  return report;
}
