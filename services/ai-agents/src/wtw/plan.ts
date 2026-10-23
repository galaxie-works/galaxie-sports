/**
 * Previsão do onde assistir (`wtw:run --plan`): grupos (competição × rodada) do horizonte, o que
 * sai só dos direitos e o que vai para a alocação por LLM, a fila de pesquisas de direitos por
 * temporada e o modelo de custo (novo × antigo, por mercado e por dia).
 */
import type { Database } from '@galaxie/db';
import { rightsAnswer, type ResearchedRightsIndex, type WtwConfig } from '@galaxie/where-to-watch';
import { groupKeyOf, roundKeyOf } from './groups.js';
import { marketRelevance, type WtwPolicy } from './relevance.js';
import { planRightsResearch, type RightsNeed } from './rights-runner.js';
import { loadUpcomingEvents, rightsForEvent, type UpcomingEvent } from './scheduler.js';
import { WTW_MAX_MATCHES_PER_CALL } from './schema.js';

/** Custo medido de uma busca completa por jogo no desenho anterior (≈ 30 mil tokens de entrada). */
export const OLD_USD_PER_SEARCH = 0.1;
/** Acréscimo estimado por mercado extra numa mesma chamada (mais linhas de saída e de busca). */
export const PER_EXTRA_MARKET = 0.05;

export type MarketDecision = 'llm' | 'deterministic' | 'to_confirm' | 'no_rights';

export interface GroupMarketPlan {
  decision: MarketDecision;
  events: number;
  deterministic: number;
  toAllocate: number;
  maxRelevance: number;
  rights: 'curated' | 'research' | null;
}

export interface GroupPlan {
  group: string;
  competition: string;
  round: string;
  firstStart: Date;
  events: number;
  markets: Record<string, GroupMarketPlan>;
  /** Chamadas de alocação (0 = nada de LLM nesta rodada). */
  calls: number;
}

export interface CostModel {
  days: number;
  markets: string[];
  gamesPerDay: number;
  allocationCalls: number;
  allocationCallsPerDay: number;
  rightsCalls: number;
  usdPerAllocation: number;
  usdPerRights: number;
  /** Alocação/dia + pesquisa de direitos amortizada em 30 dias. */
  newUsdPerDay: number;
  newUsdPerMarketDay: number;
  oldSearchesPerDay: number;
  /** Buscas completas por jogo × mercado no desenho antigo (T-7d no tier 1 + T-24h). */
  oldSearchesPerGame: number;
  oldUsdPerDay: number;
  oldUsdPerMarketDay: number;
}

export interface Forecast {
  groups: GroupPlan[];
  rightsNeeds: RightsNeed[];
  cost: CostModel;
}

const DAY = 86_400_000;

/** Mercado relevante no desenho antigo: direitos, competição do país ou internacional. */
function oldRelevant(config: WtwConfig, e: UpcomingEvent, country: string): boolean {
  if (!config.has(country)) return false;
  if (!e.countryCode || e.countryCode === 'WORLD' || e.countryCode === country) return true;
  return config.directory(country).rightsFor(e.slug, e.startsAt) !== null;
}

export async function forecast(
  db: Database,
  opts: {
    now: Date;
    days: number;
    markets: string[];
    config: WtwConfig;
    researched: ResearchedRightsIndex;
    policy: WtwPolicy;
    usdPerAllocation: number;
    usdPerRights: number;
  },
): Promise<Forecast> {
  const events = await loadUpcomingEvents(db, { now: opts.now, horizonMs: opts.days * DAY });
  const groups = new Map<string, GroupPlan>();
  for (const e of events) {
    const round = roundKeyOf(e.round, e.startsAt);
    const key = groupKeyOf(e.slug, round);
    const g =
      groups.get(key) ??
      ({
        group: key,
        competition: e.slug,
        round,
        firstStart: e.startsAt,
        events: 0,
        markets: {},
        calls: 0,
      } as GroupPlan);
    g.events++;
    for (const m of opts.markets) {
      const rights = rightsForEvent(opts.config, opts.researched, e, m);
      const mp =
        g.markets[m] ??
        ({
          decision: 'no_rights',
          events: 0,
          deterministic: 0,
          toAllocate: 0,
          maxRelevance: 0,
          rights: null,
        } as GroupMarketPlan);
      mp.events++;
      mp.rights = rights?.origin ?? mp.rights;
      const answer = rightsAnswer(rights, {
        home: null,
        away: null,
        participants: [],
        round: e.round,
      });
      if (answer.deterministic.length) mp.deterministic++;
      if (answer.needsAllocation) {
        mp.toAllocate++;
        mp.maxRelevance = Math.max(
          mp.maxRelevance,
          marketRelevance(
            {
              importance: e.importance,
              participantCountries: e.participantCountries,
              competitionCountry: e.countryCode,
              competition: { sport: e.sport, slug: e.slug },
            },
            m,
          ),
        );
      }
      g.markets[m] = mp;
    }
    groups.set(key, g);
  }
  let allocationCalls = 0;
  for (const g of groups.values()) {
    let llmEvents = 0;
    for (const mp of Object.values(g.markets)) {
      if (!mp.rights) mp.decision = 'no_rights';
      else if (!mp.toAllocate) mp.decision = 'deterministic';
      else if (mp.maxRelevance >= opts.policy.minRelevance) {
        mp.decision = 'llm';
        llmEvents = Math.max(llmEvents, mp.toAllocate);
      } else mp.decision = 'to_confirm';
    }
    g.calls = llmEvents ? Math.ceil(llmEvents / WTW_MAX_MATCHES_PER_CALL) : 0;
    allocationCalls += g.calls;
  }
  const rightsNeeds = await planRightsResearch(db, {
    now: opts.now,
    config: opts.config,
    markets: opts.markets,
    horizonDays: opts.days,
    minRelevance: opts.policy.minRelevance,
  });
  const rightsCalls = rightsNeeds.reduce((s, n) => s + n.chunks.length, 0);
  const m = Math.max(1, opts.markets.length);
  const perCall = opts.usdPerAllocation * (1 + PER_EXTRA_MARKET * (m - 1));
  const allocationCallsPerDay = allocationCalls / opts.days;
  const newUsdPerDay = allocationCallsPerDay * perCall + (rightsCalls * opts.usdPerRights) / 30;
  // desenho antigo: T-7d (tier 1) + T-24h (tiers 1 e 2), por jogo × mercado
  let oldSearches = 0;
  for (const e of events)
    for (const mk of opts.markets) if (oldRelevant(opts.config, e, mk)) oldSearches += e.tier === 1 ? 2 : 1;
  const oldUsdPerDay = (oldSearches / opts.days) * OLD_USD_PER_SEARCH;
  return {
    groups: [...groups.values()].sort((a, b) => a.firstStart.getTime() - b.firstStart.getTime()),
    rightsNeeds,
    cost: {
      days: opts.days,
      markets: opts.markets,
      gamesPerDay: events.length / opts.days,
      allocationCalls,
      allocationCallsPerDay,
      rightsCalls,
      usdPerAllocation: perCall,
      usdPerRights: opts.usdPerRights,
      newUsdPerDay,
      newUsdPerMarketDay: newUsdPerDay / m,
      oldSearchesPerDay: oldSearches / opts.days,
      oldSearchesPerGame: events.length
        ? events.reduce((s, e) => s + (e.tier === 1 ? 2 : 1), 0) / events.length
        : 1,
      oldUsdPerDay,
      oldUsdPerMarketDay: oldUsdPerDay / m,
    },
  };
}

/**
 * Tabela de escala (jogos/dia × mercados → US$/dia), antigo × novo. Antigo: cada jogo × mercado
 * pesquisa `searchesPerGame` vezes. Novo: `roundsPerDay` alocações (uma chamada cobre todos os
 * mercados; custo cresce `PER_EXTRA_MARKET` por mercado) + pesquisa de direitos amortizada.
 */
export function scaleTable(p: {
  games: number[];
  markets: number[];
  searchesPerGame: number;
  roundsPerDayPerGame: number;
  usdPerAllocation: number;
  usdPerRights: number;
  competitions: number;
}): { games: number; markets: number; oldUsd: number; newUsd: number; newPerMarket: number }[] {
  const out = [];
  for (const g of p.games)
    for (const m of p.markets) {
      const oldUsd = g * m * p.searchesPerGame * OLD_USD_PER_SEARCH;
      const alloc = g * p.roundsPerDayPerGame * p.usdPerAllocation * (1 + PER_EXTRA_MARKET * (m - 1));
      const rights = (p.competitions * Math.ceil(m / 8) * p.usdPerRights) / 30;
      const newUsd = alloc + rights;
      out.push({ games: g, markets: m, oldUsd, newUsd, newPerMarket: newUsd / m });
    }
  return out;
}
