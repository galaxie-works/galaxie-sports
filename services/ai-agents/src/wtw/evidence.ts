/**
 * Verificação das evidências por HTTP: a URL responde? a página menciona a emissora? — e a
 * revalidação de T-3h/T-30min (fetch + diff das URLs salvas, sem gastar tokens).
 */
import type { Evidence } from '@galaxie/db';
import {
  normalizeName,
  type BroadcastOptionRow,
  type Candidate,
  type CountryDirectory,
} from '@galaxie/where-to-watch';
import { contentHash, isPublicHttpUrl, type PageFetcher, type PageFetchResult } from './fetcher.js';

/** Nomes pelos quais a emissora pode aparecer na página. */
export function mentionNames(directory: CountryDirectory, name: string, channel?: string | null): string[] {
  const resolved = directory.resolve(name) ?? (channel ? directory.resolve(channel) : null);
  const e = resolved?.entry;
  const names = e
    ? [e.name, ...e.aliases, ...e.channels, ...e.regionalVariants.map((v) => v.name)]
    : [name, ...(channel ? [channel] : [])];
  return [...new Set(names.map(normalizeName).filter((n) => n.length >= 3))];
}

export function pageMentions(text: string, names: string[]): boolean {
  const page = normalizeName(text);
  return names.some((n) => page.includes(n));
}

/** O trecho salvo ainda está na página? (compara os primeiros 60 caracteres normalizados) */
export function excerptStillPresent(text: string, excerpt: string): boolean {
  const ex = normalizeName(excerpt.replace(/…$/, '')).slice(0, 60);
  return ex.length < 12 || normalizeName(text).includes(ex);
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

/** Deve ser buscada? (não: agregador sem licença, domínio bloqueado, URL não pública) */
export function shouldFetch(directory: CountryDirectory, url: string): boolean {
  return isPublicHttpUrl(url) && !directory.isAggregator(url) && !directory.blocklist.isBlockedUrl(url);
}

/**
 * Preenche `accessible`, `mentionsBroadcaster` e `contentHash` de cada evidência.
 * Agregadores ficam com `accessible: null` (pista, não evidência).
 */
export async function verifyCandidates(
  candidates: Candidate[],
  directory: CountryDirectory,
  fetcher: PageFetcher,
  now: Date,
  concurrency = 4,
): Promise<{ candidates: Candidate[]; fetched: number; failed: number }> {
  const urls = [
    ...new Set(
      candidates.flatMap((c) => c.evidence.map((e) => e.url)).filter((u) => shouldFetch(directory, u)),
    ),
  ];
  const results = new Map<string, PageFetchResult>();
  await pool(urls, concurrency, async (u) => results.set(u, await fetcher.fetch(u)));
  const fetchedAt = now.toISOString();
  const verified = candidates.map((c) => {
    const names = mentionNames(directory, c.broadcaster, c.channel);
    return {
      ...c,
      evidence: c.evidence.map((e) => {
        const r = results.get(e.url);
        if (!r) return { ...e, accessible: null, mentionsBroadcaster: null };
        return {
          ...e,
          accessible: r.ok,
          mentionsBroadcaster: r.ok ? pageMentions(r.text, names) : null,
          contentHash: r.ok ? contentHash(r.text) : null,
          fetchedAt,
        };
      }),
    };
  });
  return {
    candidates: verified,
    fetched: urls.length,
    failed: [...results.values()].filter((r) => !r.ok).length,
  };
}

/** Opção salva → candidata (para revalidar junto com o que o agente encontrou de novo). */
export function rowToCandidate(row: BroadcastOptionRow): Candidate {
  return {
    broadcaster: row.providerName,
    channel: row.channelName,
    medium: row.medium,
    accessModel: row.accessModel,
    region: row.region,
    watchUrl: row.url,
    language: row.language,
    evidence: row.evidence
      .filter((e) => e.stance !== 'denies' && e.sourceKind !== 'editorial')
      .map((e) => ({
        url: e.url,
        excerpt: e.excerpt,
        publishedAt: e.publishedAt ?? null,
        stance: e.stance ?? 'confirms',
      })),
  };
}

export interface RevalidationResult {
  /** Algo mudou (URL caiu, emissora sumiu da página, trecho saiu) → fazer busca completa. */
  changed: boolean;
  reasons: string[];
  /** Evidências com hash/fetchedAt renovados, por opção (quando nada mudou). */
  updates: { id: string; evidence: Evidence[] }[];
  fetched: number;
}

/**
 * Revalida as opções vigentes do agente: busca de novo cada URL salva e compara com o hash da
 * última verificação. Hash igual = nada mudou. Hash diferente só conta como mudança se a emissora
 * ou o trecho sumiram da página. Sem nenhuma URL buscável, conta como mudança (precisa buscar).
 */
export async function revalidateOptions(
  rows: BroadcastOptionRow[],
  directory: CountryDirectory,
  fetcher: PageFetcher,
  now: Date,
): Promise<RevalidationResult> {
  const reasons: string[] = [];
  const updates: RevalidationResult['updates'] = [];
  let fetched = 0;
  for (const row of rows) {
    const names = mentionNames(directory, row.providerName, row.channelName);
    let supported = false;
    const evidence: Evidence[] = [];
    for (const e of row.evidence) {
      if (e.stance === 'denies' || !shouldFetch(directory, e.url)) {
        evidence.push(e);
        continue;
      }
      fetched++;
      const r = await fetcher.fetch(e.url);
      if (!r.ok) {
        reasons.push(`${row.providerName}: ${e.url} indisponível (${r.error ?? r.status})`);
        evidence.push(e);
        continue;
      }
      const hash = contentHash(r.text);
      const same = !!e.contentHash && e.contentHash === hash;
      const still = same || (pageMentions(r.text, names) && excerptStillPresent(r.text, e.excerpt));
      if (still) supported = true;
      else reasons.push(`${row.providerName}: ${e.url} mudou`);
      evidence.push({ ...e, contentHash: hash, fetchedAt: now.toISOString() });
    }
    if (!supported) reasons.push(`${row.providerName}: sem evidência válida`);
    updates.push({ id: row.id, evidence });
  }
  const changed = rows.length === 0 || reasons.some((r) => r.endsWith('sem evidência válida'));
  return { changed, reasons, updates: changed ? [] : updates, fetched };
}
