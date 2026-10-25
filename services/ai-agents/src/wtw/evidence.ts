/**
 * Verificação das evidências por HTTP: a URL responde? a página menciona a emissora? Usada na
 * alocação, na revalidação de T-3h/T-30min (sem tokens) e na pesquisa/reconfirmação de direitos.
 * O fetcher compartilhado (CachingPageFetcher) busca cada URL uma vez por execução.
 */
import type { RightsHolderRecord } from '@galaxie/db';
import {
  mentionsTogether,
  normalizeName,
  type BroadcastOptionRow,
  type BroadcastRightsRow,
  type Candidate,
  type CountryDirectory,
  type RightsCandidate,
  type TeamNames,
} from '@galaxie/where-to-watch';
import { contentHash, isPublicHttpUrl, type PageFetcher, type PageFetchResult } from './fetcher.js';

/** Nomes da emissora como escritos no dicionário (para conferir por palavras). */
function rawNames(directory: CountryDirectory, name: string, channel?: string | null): string[] {
  const resolved = directory.resolve(name) ?? (channel ? directory.resolve(channel) : null);
  const e = resolved?.entry;
  return e
    ? [e.name, ...e.aliases, ...e.channels, ...e.regionalVariants.map((v) => v.name)]
    : [name, ...(channel ? [channel] : [])];
}

/** Nomes pelos quais a emissora pode aparecer na página. */
export function mentionNames(directory: CountryDirectory, name: string, channel?: string | null): string[] {
  return [
    ...new Set(
      rawNames(directory, name, channel)
        .map(normalizeName)
        .filter((n) => n.length >= 3),
    ),
  ];
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
 * Preenche `accessible`, `mentionsBroadcaster`, `excerptFound` e `contentHash` de cada evidência.
 * O jogo é conferido além da menção (a página da própria emissora sempre a cita): `excerptFound` =
 * o trecho está na página ou, com `teams`, os dois times aparecem perto da emissora (o modelo costuma
 * parafrasear o trecho). O validador rebaixa a fonte que tinha o jogo e o perdeu; a que nunca o
 * teve só leva uma penalidade leve. Agregadores ficam com `accessible: null` (pista, não evidência).
 */
export async function verifyCandidates(
  candidates: Candidate[],
  directory: CountryDirectory,
  fetcher: PageFetcher,
  now: Date,
  opts: { teams?: readonly [TeamNames, TeamNames]; concurrency?: number } = {},
): Promise<{ candidates: Candidate[]; fetched: number; failed: number }> {
  const concurrency = opts.concurrency ?? 4;
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
    const words = rawNames(directory, c.broadcaster, c.channel).filter((n) => normalizeName(n).length >= 3);
    return {
      ...c,
      evidence: c.evidence.map((e) => {
        const r = results.get(e.url);
        if (!r) return { ...e, accessible: null, mentionsBroadcaster: null };
        return {
          ...e,
          accessible: r.ok,
          mentionsBroadcaster: r.ok ? pageMentions(r.text, names) : null,
          excerptFound: r.ok
            ? (!!e.excerpt && excerptStillPresent(r.text, e.excerpt)) ||
              (!!opts.teams && mentionsTogether(r.text, opts.teams, words))
            : null,
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
      .filter((e) => e.stance !== 'denies' && e.sourceKind !== 'editorial' && e.sourceKind !== 'rights')
      .map((e) => ({
        url: e.url,
        excerpt: e.excerpt,
        publishedAt: e.publishedAt ?? null,
        stance: e.stance ?? 'confirms',
        ...(e.excerptVerified ? { excerptVerified: true } : {}),
      })),
  };
}

/** Evidências da pesquisa de direitos verificadas por HTTP (mesmas regras das opções). */
export async function verifyRightsCandidate(
  candidate: RightsCandidate,
  directory: CountryDirectory,
  fetcher: PageFetcher,
  now: Date,
): Promise<{ candidate: RightsCandidate; fetched: number }> {
  let fetched = 0;
  const holders = [];
  for (const h of candidate.holders) {
    const names = mentionNames(directory, h.broadcaster, h.channels[0] ?? null);
    const evidence = [];
    for (const e of h.evidence) {
      if (!shouldFetch(directory, e.url)) {
        evidence.push({ ...e, accessible: null, mentionsBroadcaster: null });
        continue;
      }
      fetched++;
      const r = await fetcher.fetch(e.url);
      evidence.push({
        ...e,
        accessible: r.ok,
        mentionsBroadcaster: r.ok ? pageMentions(r.text, names) : null,
        contentHash: r.ok ? contentHash(r.text) : null,
        fetchedAt: now.toISOString(),
      });
    }
    holders.push({ ...h, evidence });
  }
  return { candidate: { ...candidate, holders }, fetched };
}

/**
 * Reconfirmação mensal dos direitos pesquisados (sem tokens): cada detentor confirmado continua
 * com ao menos uma fonte acessível que o menciona? Renova hash e data das evidências.
 */
export async function recheckRightsRow(
  row: BroadcastRightsRow,
  directory: CountryDirectory,
  fetcher: PageFetcher,
  now: Date,
): Promise<{ supported: boolean; holders: RightsHolderRecord[]; reasons: string[] }> {
  const reasons: string[] = [];
  const holders: RightsHolderRecord[] = [];
  for (const h of row.holders) {
    const names = mentionNames(directory, h.name, h.channels[0] ?? null);
    let ok = false;
    const evidence = [];
    for (const e of h.evidence) {
      if (!shouldFetch(directory, e.url)) {
        evidence.push(e);
        continue;
      }
      const r = await fetcher.fetch(e.url);
      const hash = r.ok ? contentHash(r.text) : null;
      if (r.ok && ((e.contentHash && e.contentHash === hash) || pageMentions(r.text, names))) ok = true;
      evidence.push({ ...e, contentHash: hash ?? e.contentHash ?? null, fetchedAt: now.toISOString() });
    }
    if (h.status === 'confirmed' && !ok) reasons.push(`${h.name}: fontes não sustentam mais`);
    holders.push({ ...h, evidence });
  }
  return { supported: reasons.length === 0, holders, reasons };
}
