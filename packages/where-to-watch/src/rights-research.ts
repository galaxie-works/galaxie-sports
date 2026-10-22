/**
 * Direitos pesquisados por temporada (docs/07 §2.2, nível 1): validação determinística do que o
 * LLM propôs (função pura) e persistência versionada em enrich.broadcast_rights. A linha curada
 * de config/broadcast-rights sempre vence a pesquisada (`effectiveRights`).
 */
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  broadcastRights,
  type BroadcasterKind,
  type Database,
  type Evidence,
  type RightsDistribution,
  type RightsHolderRecord,
} from '@galaxie/db';
import type { CountryDirectory } from './config/directory.js';
import type { RightsEntry } from './config/types.js';
import { clipExcerpt, hostOf, isHttpUrl, registrableDomain } from './normalize.js';
import { SCORING, SOURCE_SCORES, type CandidateEvidence } from './validator.js';

export const RIGHTS_PRODUCER = 'agent:wtw-rights@v1';
export type BroadcastRightsRow = typeof broadcastRights.$inferSelect;

/** Detentor proposto pela pesquisa (evidências já verificadas por HTTP). */
export interface RightsHolderCandidate {
  broadcaster: string;
  channels: string[];
  kind: BroadcasterKind | null;
  allMatches: boolean;
  evidence: CandidateEvidence[];
}

export interface RightsCandidate {
  country: string;
  distribution: RightsDistribution;
  holders: RightsHolderCandidate[];
  notes: string | null;
}

export interface ValidatedRights {
  country: string;
  distribution: RightsDistribution;
  holders: RightsHolderRecord[];
  status: 'confirmed' | 'pending';
  confidence: number;
  flags: string[];
  notes: string | null;
  discarded: { broadcaster: string; reason: string }[];
}

/** Tipos de fonte aceitos como evidência de direitos (agregador e desconhecida não sustentam). */
const RIGHTS_SOURCE_KINDS = new Set(['broadcaster', 'organizer', 'press']);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Confere cada detentor proposto: nome no dicionário do país (desconhecido fica `pending`, fora da
 * publicação), evidência acessível em domínio permitido do país que menciona a emissora, confiança
 * pelas mesmas notas do validador de opções. A distribuição só vale se todos os detentores que a
 * sustentam passaram; senão vira `to_confirm`.
 */
export function validateRightsResearch(
  candidate: RightsCandidate,
  ctx: { directory: CountryDirectory; now: Date },
): ValidatedRights {
  const dir = ctx.directory;
  const discarded: ValidatedRights['discarded'] = [];
  const flags = new Set<string>();
  const byKey = new Map<string, RightsHolderRecord & { domains: Set<string> }>();

  for (const h of candidate.holders) {
    const name = h.broadcaster.trim();
    if (!name || dir.blocklist.isBlockedName(name)) {
      discarded.push({ broadcaster: '[bloqueado]', reason: 'blocked' });
      continue;
    }
    const resolved = dir.resolve(name);
    if (resolved && dir.blocklist.isBlockedName(resolved.entry.name)) {
      discarded.push({ broadcaster: '[bloqueado]', reason: 'blocked' });
      continue;
    }
    const entry = resolved?.entry ?? null;
    const key = entry?.id ?? `unknown:${name.toLowerCase()}`;
    const rec = byKey.get(key) ?? {
      broadcasterId: entry?.id ?? null,
      name: entry?.name ?? name.slice(0, 80),
      channels: [],
      kind: h.kind,
      allMatches: false,
      status: 'pending' as const,
      confidence: 0,
      evidence: [] as Evidence[],
      flags: entry ? [] : ['unknown_broadcaster'],
      domains: new Set<string>(),
    };
    rec.allMatches ||= h.allMatches;
    for (const c of h.channels) if (c.trim() && !rec.channels.includes(c.trim())) rec.channels.push(c.trim());
    for (const ev of h.evidence) {
      if (!isHttpUrl(ev.url) || dir.blocklist.isBlockedUrl(ev.url) || ev.accessible !== true) continue;
      const kind = dir.classifySource(ev.url, entry);
      if (!RIGHTS_SOURCE_KINDS.has(kind)) continue;
      let score = SOURCE_SCORES[kind];
      if (ev.mentionsBroadcaster === false) {
        score = Math.min(score, SOURCE_SCORES.aggregator);
        if (!rec.flags.includes('excerpt_not_found')) rec.flags.push('excerpt_not_found');
      }
      if (rec.evidence.some((e) => e.url === ev.url)) continue;
      rec.evidence.push({
        url: ev.url,
        excerpt: clipExcerpt(ev.excerpt ?? ''),
        publisher: hostOf(ev.url)!,
        fetchedAt: ev.fetchedAt ?? ctx.now.toISOString(),
        sourceKind: kind,
        publishedAt: ev.publishedAt ?? null,
        contentHash: ev.contentHash ?? null,
        stance: 'confirms',
      });
      if (score >= SOURCE_SCORES.press) rec.domains.add(registrableDomain(hostOf(ev.url)!));
      rec.confidence = Math.max(rec.confidence, score);
    }
    byKey.set(key, rec);
  }

  const holders: RightsHolderRecord[] = [];
  for (const rec of byKey.values()) {
    if (!rec.evidence.length) {
      discarded.push({ broadcaster: rec.name, reason: 'no_accessible_evidence' });
      continue;
    }
    const confidence = round2(
      Math.min(1, rec.confidence + (rec.domains.size >= 2 ? SCORING.independentSources : 0)),
    );
    if (confidence < SCORING.pendingThreshold) {
      discarded.push({ broadcaster: rec.name, reason: 'low_confidence' });
      continue;
    }
    const { domains: _d, ...holder } = rec;
    holder.confidence = confidence;
    holder.status = rec.broadcasterId && confidence >= SCORING.publishThreshold ? 'confirmed' : 'pending';
    if (holder.status !== 'confirmed') holder.allMatches = false;
    holders.push(holder);
  }
  holders.sort((a, b) => a.name.localeCompare(b.name));

  const confirmed = holders.filter((h) => h.status === 'confirmed');
  let distribution = candidate.distribution;
  const lost = candidate.holders.length > confirmed.length;
  if ((distribution === 'exclusive' || distribution === 'all_matches') && (lost || !confirmed.length)) {
    distribution = 'to_confirm';
    flags.add('distribution_unverified');
  }
  if (distribution === 'exclusive' && confirmed.length > 1) {
    const groups = new Set(confirmed.map((h) => dir.byIdOrNull(h.broadcasterId)?.group ?? h.broadcasterId));
    if (groups.size > 1) {
      distribution = 'all_matches';
      flags.add('exclusive_multi_group');
    }
  }
  return {
    country: candidate.country,
    distribution,
    holders,
    status: confirmed.length ? 'confirmed' : 'pending',
    confidence: confirmed.length
      ? Math.min(...confirmed.map((h) => h.confidence))
      : Math.max(0, ...holders.map((h) => h.confidence)),
    flags: [...flags].sort(),
    notes: candidate.notes,
    discarded,
  };
}

/** Linha pesquisada (confirmada) → linha de direitos usada pela resposta determinística. */
export function rowToRightsEntry(row: BroadcastRightsRow): RightsEntry | null {
  if (row.status !== 'confirmed') return null;
  const ok = row.holders.filter((h) => h.status === 'confirmed' && h.broadcasterId);
  if (!ok.length) return null;
  return {
    competition: row.competitionSlug,
    season: row.season,
    validFrom: `${row.season}-01-01`,
    validTo: `${row.season + 1}-06-30`,
    perRoundSelection: row.distribution === 'split' || row.distribution === 'selected',
    holders: ok.map((h) => h.broadcasterId!),
    uncertainHolders: row.holders
      .filter((h) => h.status !== 'confirmed' && h.broadcasterId)
      .map((h) => h.broadcasterId!),
    distribution: row.distribution,
    allMatches: ok.filter((h) => h.allMatches).map((h) => h.broadcasterId!),
    rules: [],
    notes: row.notes,
    sources: [...new Set(ok.flatMap((h) => h.evidence.map((e) => e.url)))],
    origin: 'research',
    confidence: Number(row.confidence),
  };
}

/** Versões vigentes (sem lápides) das pesquisas de direitos. */
export async function currentResearchedRights(
  db: Database,
  filter: { competitions?: string[]; countries?: string[] } = {},
): Promise<BroadcastRightsRow[]> {
  const conds = [isNull(broadcastRights.supersededBy), ne(broadcastRights.status, 'retracted')];
  if (filter.competitions?.length) conds.push(inArray(broadcastRights.competitionSlug, filter.competitions));
  if (filter.countries?.length) conds.push(inArray(broadcastRights.countryCode, filter.countries));
  return db
    .select()
    .from(broadcastRights)
    .where(and(...conds));
}

/** Índice competição|temporada|país → linha de direitos pesquisada (já convertida). */
export class ResearchedRightsIndex {
  private readonly map = new Map<string, RightsEntry>();
  constructor(rows: BroadcastRightsRow[]) {
    for (const r of rows) {
      const e = rowToRightsEntry(r);
      if (e) this.map.set(`${r.competitionSlug}|${r.season}|${r.countryCode}`, e);
    }
  }
  get(competition: string | null | undefined, season: number | null | undefined, country: string) {
    if (!competition || season === null || season === undefined) return null;
    return this.map.get(`${competition}|${season}|${country}`) ?? null;
  }
  get size(): number {
    return this.map.size;
  }
}

const material = (v: { distribution: string; status: string; holders: RightsHolderRecord[] }): string =>
  JSON.stringify([
    v.distribution,
    v.status,
    [...v.holders]
      .map((h) => [h.broadcasterId ?? h.name, h.status, h.allMatches, [...h.channels].sort()])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);

export interface ApplyRightsInput {
  competition: string;
  season: number;
  result: ValidatedRights;
  researchId?: string | null;
  now: Date;
}

/** Grava a pesquisa validada de um país: nova versão se mudou; senão só renova a verificação. */
export async function applyRightsResult(
  db: Database,
  input: ApplyRightsInput,
): Promise<{ action: 'inserted' | 'touched'; id: string }> {
  return db.transaction(async (tx) => {
    const [prev] = await tx
      .select()
      .from(broadcastRights)
      .where(
        and(
          eq(broadcastRights.competitionSlug, input.competition),
          eq(broadcastRights.season, input.season),
          eq(broadcastRights.countryCode, input.result.country),
          isNull(broadcastRights.supersededBy),
        ),
      );
    const r = input.result;
    if (prev && prev.status !== 'retracted' && material(prev) === material(r)) {
      await tx
        .update(broadcastRights)
        .set({
          holders: r.holders,
          confidence: r.confidence.toFixed(2),
          lastVerifiedAt: input.now,
          researchId: input.researchId ?? prev.researchId,
        })
        .where(eq(broadcastRights.id, prev.id));
      return { action: 'touched' as const, id: prev.id };
    }
    const [row] = await tx
      .insert(broadcastRights)
      .values({
        competitionSlug: input.competition,
        season: input.season,
        countryCode: r.country,
        distribution: r.distribution,
        holders: r.holders,
        status: r.status,
        confidence: r.confidence.toFixed(2),
        notes: r.notes,
        flags: r.flags,
        producedBy: RIGHTS_PRODUCER,
        researchId: input.researchId ?? null,
        lastVerifiedAt: input.now,
        createdAt: input.now,
      })
      .returning({ id: broadcastRights.id });
    if (prev)
      await tx
        .update(broadcastRights)
        .set({ supersededBy: row!.id, supersededAt: input.now })
        .where(eq(broadcastRights.id, prev.id));
    return { action: 'inserted' as const, id: row!.id };
  });
}

/**
 * Reconfirmação barata (sem tokens): a linha continua sustentada pelas próprias fontes? Renova
 * `last_verified_at`; se algum detentor confirmado perdeu todas as fontes, a linha ganha a flag
 * `source_changed` (nova versão `pending`) e volta para a fila de pesquisa.
 */
export async function markRightsVerified(
  db: Database,
  row: BroadcastRightsRow,
  check: { supported: boolean; holders: RightsHolderRecord[] },
  now: Date,
): Promise<'touched' | 'source_changed'> {
  if (check.supported) {
    await db
      .update(broadcastRights)
      .set({ lastVerifiedAt: now, holders: check.holders })
      .where(eq(broadcastRights.id, row.id));
    return 'touched';
  }
  await db.transaction(async (tx) => {
    const [next] = await tx
      .insert(broadcastRights)
      .values({
        competitionSlug: row.competitionSlug,
        season: row.season,
        countryCode: row.countryCode,
        distribution: row.distribution,
        holders: check.holders,
        status: 'pending',
        confidence: row.confidence,
        notes: row.notes,
        flags: [...new Set([...row.flags, 'source_changed'])].sort(),
        producedBy: row.producedBy,
        researchId: row.researchId,
        lastVerifiedAt: now,
        createdAt: now,
      })
      .returning({ id: broadcastRights.id });
    await tx
      .update(broadcastRights)
      .set({ supersededBy: next!.id, supersededAt: now })
      .where(eq(broadcastRights.id, row.id));
  });
  return 'source_changed';
}
