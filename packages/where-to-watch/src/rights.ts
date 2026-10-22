/**
 * Resposta determinística a partir dos direitos (docs/07 §2.2, nível 1): para um jogo num país,
 * quais detentores transmitem com certeza (regra da tabela) e quais ainda dependem da alocação por
 * rodada (LLM) — ou ficam "a confirmar". Funções puras: sem rede e sem banco.
 */
import type { CountryDirectory } from './config/directory.js';
import type { RightsEntry } from './config/types.js';
import { normalizeName } from './normalize.js';
import type { Candidate } from './validator.js';

/** Fatos do jogo usados pelas regras de direitos (vêm do core, nunca do LLM). */
export interface MatchFacts {
  home: string | null;
  away: string | null;
  participants: string[];
  /** Rótulo da rodada no fornecedor (ex.: "Regular Season - 32"); null = sem rodada. */
  round: string | null;
}

export const NO_MATCH_FACTS: MatchFacts = { home: null, away: null, participants: [], round: null };

export interface RightsAnswer {
  entry: RightsEntry | null;
  /** Detentores com o jogo garantido pela tabela (publicação sem LLM). */
  deterministic: string[];
  /** Detentores que podem ter o jogo: a alocação por rodada decide; sem ela, "a confirmar". */
  toAllocate: string[];
  needsAllocation: boolean;
}

const sameName = (a: string | null | undefined, b: string) => !!a && normalizeName(a) === normalizeName(b);

/** Regra da linha de direitos → detentores determinísticos e os que ficam para a alocação. */
export function rightsAnswer(entry: RightsEntry | null, match: MatchFacts): RightsAnswer {
  if (!entry || !entry.holders.length)
    return { entry, deterministic: [], toAllocate: [], needsAllocation: false };
  const det = new Set<string>(entry.allMatches);
  if (entry.distribution === 'exclusive' || entry.distribution === 'all_matches')
    for (const h of entry.holders) det.add(h);
  for (const rule of entry.rules) {
    const home = !rule.homeTeams.length || rule.homeTeams.some((t) => sameName(match.home, t));
    const teams =
      !rule.teams.length ||
      rule.teams.some((t) => [match.home, match.away, ...match.participants].some((p) => sameName(p, t)));
    const round = !rule.rounds.length || rule.rounds.some((r) => sameName(match.round, r));
    if (home && teams && round) for (const h of rule.holders) det.add(h);
  }
  const deterministic = entry.holders.filter((h) => det.has(h));
  const toAllocate = entry.holders.filter((h) => !det.has(h));
  return { entry, deterministic, toAllocate, needsAllocation: toAllocate.length > 0 };
}

/**
 * Candidatas vindas dos direitos (origem `rights`): os determinísticos e, com `includeToConfirm`,
 * os detentores ainda não alocados ("a confirmar"). A evidência são as fontes da linha de direitos
 * — o validador confere que cada URL está mesmo na linha (não é texto do LLM).
 */
export function rightsCandidates(
  answer: RightsAnswer,
  directory: CountryDirectory,
  opts: { includeToConfirm: boolean; exclude?: Set<string> } = { includeToConfirm: true },
): Candidate[] {
  const entry = answer.entry;
  if (!entry) return [];
  const make = (id: string, toConfirm: boolean): Candidate | null => {
    const b = directory.byIdOrNull(id);
    if (!b || opts.exclude?.has(id)) return null;
    return {
      broadcaster: b.name,
      origin: 'rights',
      toConfirm,
      evidence: entry.sources.map((url) => ({
        url,
        excerpt: entry.notes ?? `Detentor de direitos: ${b.name}`,
        publishedAt: null,
        stance: 'confirms' as const,
      })),
    };
  };
  const out = answer.deterministic.map((id) => make(id, false));
  if (opts.includeToConfirm) out.push(...answer.toAllocate.map((id) => make(id, true)));
  return out.filter((c): c is Candidate => c !== null);
}

/** Direitos efetivos: a linha curada (config) sempre vence a pesquisada (banco). */
export function effectiveRights(
  curated: RightsEntry | null,
  researched: RightsEntry | null | undefined,
): RightsEntry | null {
  return curated ?? researched ?? null;
}
