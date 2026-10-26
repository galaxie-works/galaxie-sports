/**
 * Execução do agente de Conteúdo relacionado (docs/12 §5): jogos encerrados nas últimas horas (ou um
 * evento), uploads recentes dos canais conhecidos (clubes, competição, emissoras detentoras: 1 unidade por
 * página), busca na YouTube Data API só como complemento e dentro do balde de consultas do dia (com reserva
 * para os jogos que ainda vão acontecer), relevância e política em código, classificação pelo LLM `light`
 * (fallback por regras) e gravação versionada em enrich.related_content.
 */
import { and, desc, eq, gte, inArray, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  competition,
  event,
  participant,
  readPlaybackBlocks,
  relatedRun,
  type Database,
  type RelatedContentRow,
  type RelatedSkippedGame,
  type RelatedUpcomingGame,
} from '@galaxie/db';
import type { WtwConfig } from '@galaxie/where-to-watch';
import {
  competitionName,
  loadEventCore,
  stageName,
  teamName,
  type EventCore,
} from '../context/event-core.js';
import { eventMatchLabel } from '../context/run.js';
import { findForbiddenTerms, sanitizeExcerpt } from '../guardrails/index.js';
import { sanitizeText } from '../llm/hygiene.js';
import type { LlmClient } from '../llm/types.js';
import { buildGoals, loadIncidents } from '../recap/facts.js';
import { marketRelevance } from '../wtw/relevance.js';
import {
  bucketLimits,
  DEFAULT_QUOTA_RESERVE_PERCENT,
  DEFAULT_YOUTUBE_DAILY_QUOTA,
  DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA,
  expectedSearches,
  isForeign,
  marketScore,
  queueGroup,
  reserveFor,
  searchAllowance,
  totalReserve,
  YIELD_DAYS,
  yieldFactors,
  type CompetitionYieldRow,
  type QueueGroup,
  type QuotaState,
  type UpcomingGame,
  type YieldFactor,
} from './budget.js';
import { broadcastersWithChannels, ChannelBook, matchUploads } from './channel-map.js';
import { rightsHoldersFor, type ChannelAllowlist, type ChannelScope } from './channels.js';
import {
  aspectRatioOf,
  classifyVideos,
  detectFormat,
  RULES_CLASSIFIER,
  type ClassifyFacts,
} from './classify.js';
import { checkRelevance, decidePublication, rankScore, teamVariants } from './policy.js';
import {
  capPublished,
  fullSearchDue,
  nextMode,
  rankRelatedCandidates,
  relatedPolicyFromEnv,
  videoLocale,
  type RankableCandidate,
  type RelatedMode,
  type RelatedPolicy,
} from './priority.js';
import {
  buildRelatedQueries,
  capQueries,
  languagesFor,
  languagesForMarkets,
  type RelatedQuery,
} from './queries.js';
import {
  CHANNEL_QUERY_PREFIX,
  competitionYields,
  currentRelatedRows,
  purgeYoutubeData,
  quotaUsage,
  saveRelatedBudget,
  saveRelatedContent,
  type RelatedItemInput,
} from './store.js';
import {
  youtubeQuotaDay,
  youtubeQuotaDayEnd,
  type ChannelDetail,
  type VideoDetail,
  type YoutubeClient,
} from './youtube.js';

export { DEFAULT_QUOTA_RESERVE_PERCENT, DEFAULT_YOUTUBE_DAILY_QUOTA, DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA };
export const DEFAULT_RESEARCH_HOURS = 12;
/** Jogo da agenda conta para a reserva se começa até N minutos antes do fim do dia de cota (acaba antes dele). */
export const AGENDA_END_MARGIN_MINUTES = 105;
/** Jogo já em andamento conta para a reserva se começou há menos de N horas. */
export const AGENDA_LIVE_HOURS = 3;
/** Mercado entra nos idiomas da busca se a relevância ponderada dele chega a esta fração da melhor. */
export const LANGUAGE_SCORE_SHARE = 0.6;

export interface RelatedRunOptions {
  now?: Date;
  /** Um evento específico (ignora janela e tier). */
  eventId?: string;
  /** Janela para trás a partir do início do jogo, em horas (padrão 48). */
  lookbackHours?: number;
  maxTier?: number;
  limit?: number;
  /** Só mostra candidatos, consultas e unidades estimadas (nada é chamado nem gravado). */
  plan?: boolean;
  /** Busca completa mesmo dentro da janela de revalidação. */
  force?: boolean;
  llm: LlmClient | null;
  /** Obrigatório fora do --plan. */
  youtube: YoutubeClient | null;
  allowlist: ChannelAllowlist;
  wtw: WtwConfig;
  /** Unidades/dia do balde geral (videos, channels, playlistItems). */
  dailyQuota?: number;
  /** Consultas `search.list` por dia (balde próprio). */
  searchDailyQuota?: number;
  /** Folga dos dois baldes que o agente nunca gasta (%). */
  reservePercent?: number;
  /** Busca completa no máximo a cada N horas por evento (padrão 12); no meio, canais ou revalidação. */
  researchHours?: number;
  maxSearchesPerLanguage?: number;
  requestedBy?: string;
  /** Mercados, relevância, pesos, tetos, canais e reserva (padrão: `relatedPolicyFromEnv`). */
  policy?: RelatedPolicy;
  /** Piso de inscritos para canal do Wikidata valer (padrão: o da allowlist). */
  channelMinSubscribers?: number;
  /** Histórico de rendimento além do banco (simulação com o histórico real da produção). */
  yieldRows?: readonly CompetitionYieldRow[];
}

export interface RelatedRunItem {
  eventId: string;
  label: string;
  startsAt: string;
  action: 'searched' | 'channels' | 'revalidated' | 'planned' | 'skipped' | 'error';
  mode?: RelatedMode;
  /** Maior relevância do jogo nos mercados ativos. */
  relevance?: number;
  /** Prioridade (relevância × peso do mercado × rendimento da competição). */
  score?: number;
  group?: QueueGroup;
  reason?: string;
  queries?: string[];
  /** Consultas `search.list` (feitas ou, no --plan, previstas). */
  searches?: number;
  /** Unidades do balde geral (feitas ou previstas). */
  units?: number;
  /** Canais conhecidos lidos. */
  channels?: number;
  candidates?: number;
  published?: number;
  pending?: number;
  rejected?: number;
  /** tipo → quantidade publicada nesta execução. */
  types?: Record<string, number>;
  llm?: boolean;
  /** Pulado (ou sem busca) por cota: entra na lista do painel. */
  quotaSkip?: boolean;
}

export interface RelatedRunReport {
  items: RelatedRunItem[];
  quotaDay: string;
  quota: {
    search: { limit: number; usedBefore: number; spent: number; reserved: number };
    api: { limit: number; usedBefore: number; spent: number };
  };
  /** Candidatos sem nada a fazer nesta execução (em dia). */
  idle: number;
  llmCalls: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  expired: number;
}

export interface RelatedCandidate extends RankableCandidate {
  /** Relevância (0–100) do jogo em cada mercado ativo. */
  byMarket: Record<string, number>;
  score: number;
  group: QueueGroup;
  competitionId: string | null;
  competitionSlug: string | null;
  fullRuns: number;
  lastFull: Date | null;
  lastChannels: Date | null;
  lastAny: Date | null;
  /** Consultas já gastas no jogo (todas as execuções). */
  searchesSoFar: number;
  /** Vídeos guardados vivos (não retirados nem expirados). */
  alive: number;
  /** Canais do mapa ligados aos clubes ou à competição. */
  channelLinks: number;
  /** Algum detentor de direitos nos mercados tem canal no mapa. */
  holderChannels: boolean;
}

interface FactsOptions {
  conds: SQL[];
  markets: string[];
  weights: Record<string, number>;
  yields: Map<string, YieldFactor>;
  wtw: WtwConfig;
  broadcasters: Set<string>;
  foreignLast: boolean;
}

/** Fatos dos jogos (relevância e prioridade por mercado, histórico de execuções, canais conhecidos). */
async function gameFacts(db: Database, opts: FactsOptions): Promise<RelatedCandidate[]> {
  const rows = await db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      importance: event.importance,
      competitionId: competition.id,
      sport: competition.sport,
      slug: competition.slug,
      countryCode: competition.countryCode,
      participantCountries: sql<(string | null)[]>`coalesce((
        select array_agg(p.country_code) from core.event_participant ep
          join core.participant p on p.id = ep.participant_id
         where ep.event_id = ${event.id}), '{}')`,
      fullRuns: sql<number>`(select count(*)::int from enrich.related_run r
         where r.event_id = ${event.id} and r.mode = 'full' and r.status = 'done')`,
      lastFull: sql<Date | null>`(select max(r.started_at) from enrich.related_run r
         where r.event_id = ${event.id} and r.mode = 'full' and r.status = 'done')`,
      lastChannels: sql<Date | null>`(select max(r.started_at) from enrich.related_run r
         where r.event_id = ${event.id} and r.mode in ('full', 'channels') and r.status = 'done')`,
      lastAny: sql<Date | null>`(select max(r.started_at) from enrich.related_run r
         where r.event_id = ${event.id} and r.status = 'done')`,
      searchesSoFar: sql<number>`(select coalesce(sum(r.searches), 0)::int from enrich.related_run r
         where r.event_id = ${event.id})`,
      alive: sql<number>`(select count(*)::int from enrich.related_content rc
         where rc.event_id = ${event.id} and rc.superseded_by is null
           and rc.status not in ('retracted', 'expired'))`,
      channelLinks: sql<number>`(select count(*)::int from enrich.related_channel ch
         where ch.active and ((ch.kind = 'competition' and ch.competition_id = ${event.competitionId})
            or (ch.kind = 'club' and ch.participant_id in (
                  select ep.participant_id from core.event_participant ep where ep.event_id = ${event.id}))))`,
    })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .where(and(...opts.conds));
  const date = (d: unknown) => (d ? new Date(d as string) : null);
  return rows.map((r) => {
    const byMarket = Object.fromEntries(
      opts.markets.map((m) => [
        m,
        marketRelevance(
          {
            importance: Number(r.importance ?? 0),
            participantCountries: r.participantCountries ?? [],
            competitionCountry: r.countryCode,
            competition: { sport: r.sport, slug: r.slug },
          },
          m,
        ),
      ]),
    );
    const y = opts.yields.get(r.competitionId);
    const foreign = isForeign({
      competitionCountry: r.countryCode,
      participantCountries: r.participantCountries ?? [],
      markets: opts.markets,
    });
    const fullRuns = Number(r.fullRuns ?? 0);
    const holders = rightsHoldersFor(opts.wtw, r.slug, opts.markets, r.startsAt);
    return {
      id: r.id,
      startsAt: r.startsAt,
      relevance: Math.max(0, ...Object.values(byMarket)),
      byMarket,
      score: Math.round(marketScore(byMarket, opts.weights) * (y?.factor ?? 1) * 10) / 10,
      group: opts.foreignLast ? queueGroup({ foreign, zeroYield: !!y?.zero }) : 0,
      competitionId: r.competitionId,
      competitionSlug: r.slug,
      fullRuns,
      lastFull: date(r.lastFull),
      lastChannels: date(r.lastChannels),
      lastAny: date(r.lastAny),
      searchesSoFar: Number(r.searchesSoFar ?? 0),
      alive: Number(r.alive ?? 0),
      channelLinks: Number(r.channelLinks ?? 0),
      holderChannels: [...holders].some((h) => opts.broadcasters.has(h)),
      firstSearchPending: fullRuns === 0,
    };
  });
}

/** Contexto de prioridade de uma execução: pesos, rendimento por competição e emissoras com canal. */
async function priorityContext(
  db: Database,
  opts: { now: Date; policy: RelatedPolicy; wtw: WtwConfig; yieldRows?: readonly CompetitionYieldRow[] },
): Promise<Omit<FactsOptions, 'conds'>> {
  const [fromDb, broadcasters] = await Promise.all([
    competitionYields(db, new Date(opts.now.getTime() - YIELD_DAYS * 86_400_000)),
    broadcastersWithChannels(db),
  ]);
  // histórico extra (simulação): soma ao do banco por competição
  const merged = new Map<string, CompetitionYieldRow>();
  for (const r of [...fromDb, ...(opts.yieldRows ?? [])]) {
    const p = merged.get(r.competitionId);
    merged.set(
      r.competitionId,
      p
        ? {
            ...p,
            games: p.games + r.games,
            searches: p.searches + r.searches,
            apiUnits: p.apiUnits + r.apiUnits,
            searchVideos: p.searchVideos + r.searchVideos,
            channelVideos: p.channelVideos + r.channelVideos,
          }
        : r,
    );
  }
  return {
    markets: opts.policy.markets,
    weights: opts.policy.marketWeights,
    yields: yieldFactors([...merged.values()]),
    wtw: opts.wtw,
    broadcasters,
    foreignLast: opts.policy.foreignLast,
  };
}

/**
 * Fila do agente: jogos encerrados na janela, com relevância ≥ mínima nos mercados ativos, na ordem de
 * `rankRelatedCandidates` (grupo → primeira busca pendente → prioridade → mais recente).
 */
export async function relatedCandidates(
  db: Database,
  opts: {
    now: Date;
    lookbackHours: number;
    maxTier: number;
    limit: number;
    policy: RelatedPolicy;
    wtw: WtwConfig;
  },
): Promise<RelatedCandidate[]> {
  const ctx = await priorityContext(db, opts);
  const facts = await gameFacts(db, {
    ...ctx,
    conds: [
      eq(event.sport, 'football'),
      eq(event.status, 'finished'),
      gte(event.startsAt, new Date(opts.now.getTime() - opts.lookbackHours * 3_600_000)),
      lte(event.startsAt, opts.now),
      lte(competition.tier, opts.maxTier),
    ],
  });
  return rankRelatedCandidates(facts, opts.policy.minRelevance).slice(0, opts.limit);
}

/**
 * Agenda do dia de cota: jogos de futebol nos mercados ativos que ainda vão acontecer (ou estão em
 * andamento) e terminam antes de a cota zerar, com relevância ≥ mínima. É para eles que a reserva existe.
 */
export async function upcomingGames(
  db: Database,
  opts: { now: Date; maxTier: number; policy: RelatedPolicy; ctx: Omit<FactsOptions, 'conds'> },
): Promise<UpcomingGame[]> {
  const until = new Date(youtubeQuotaDayEnd(opts.now).getTime() - AGENDA_END_MARGIN_MINUTES * 60_000);
  if (until <= opts.now) return [];
  // também o jogo que acabou e ainda espera a primeira busca (`searchAfterKickoffMinutes`): sem isso, os de
  // prioridade menor gastariam a fatia dele no intervalo entre o apito e a busca
  const waiting = new Date(opts.now.getTime() - opts.policy.searchAfterKickoffMinutes * 60_000);
  const facts = await gameFacts(db, {
    ...opts.ctx,
    conds: [
      eq(event.sport, 'football'),
      notInArray(event.status, ['postponed', 'cancelled', 'abandoned', 'suspended']),
      gte(event.startsAt, new Date(opts.now.getTime() - AGENDA_LIVE_HOURS * 3_600_000)),
      lte(event.startsAt, until),
      lte(competition.tier, opts.maxTier),
      sql`(${event.status} <> 'finished' or ${event.startsAt} > ${waiting.toISOString()}::timestamptz)`,
    ],
  });
  return facts
    .filter((f) => f.group === 0 && f.relevance >= opts.policy.minRelevance && f.searchesSoFar === 0)
    .map((f) => ({
      id: f.id,
      startsAt: f.startsAt,
      score: f.score,
      expected: expectedSearches({
        channels: opts.policy.channelsFirst ? f.channelLinks + (f.holderChannels ? 1 : 0) : 0,
        maxSearchesPerRun: opts.policy.maxSearchesPerRun,
      }),
    }))
    .sort((a, b) => b.score - a.score);
}

async function teamCountries(db: Database, core: EventCore): Promise<(string | null)[]> {
  const rows = await db
    .select({ id: participant.id, country: participant.countryCode })
    .from(participant)
    .where(inArray(participant.id, [core.home.id, core.away.id]));
  return [core.home.id, core.away.id].map((id) => rows.find((r) => r.id === id)?.country ?? null);
}

async function lastFullRun(db: Database, eventId: string): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: relatedRun.startedAt })
    .from(relatedRun)
    .where(and(eq(relatedRun.eventId, eventId), eq(relatedRun.mode, 'full'), eq(relatedRun.status, 'done')))
    .orderBy(desc(relatedRun.startedAt))
    .limit(1);
  return row?.startedAt ?? null;
}

function classifyFacts(core: EventCore, scorers: string[]): ClassifyFacts {
  const s = core.score;
  return {
    home: teamName(core.home, 'pt-BR'),
    away: teamName(core.away, 'pt-BR'),
    competition: competitionName(core, 'pt-BR'),
    stage: stageName(core, 'pt-BR'),
    kickoff: core.startsAt.toISOString(),
    score: {
      home: typeof s?.home === 'number' ? s.home : null,
      away: typeof s?.away === 'number' ? s.away : null,
      penalties:
        s?.penalty && typeof s.penalty.home === 'number' && typeof s.penalty.away === 'number'
          ? { home: s.penalty.home, away: s.penalty.away }
          : null,
    },
    scorers,
  };
}

const videoUrl = (id: string, format: 'short' | 'long') =>
  format === 'short' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;

/** Mercados para os idiomas da busca: os que chegam a `LANGUAGE_SCORE_SHARE` da melhor relevância ponderada. */
function searchMarkets(cand: RelatedCandidate, policy: RelatedPolicy): Record<string, number> {
  const weighted = (m: string) => (cand.byMarket[m] ?? 0) * (policy.marketWeights[m] ?? 0.3);
  const best = Math.max(0, ...Object.keys(cand.byMarket).map(weighted));
  return Object.fromEntries(
    Object.entries(cand.byMarket).filter(([m]) => weighted(m) >= best * LANGUAGE_SCORE_SHARE),
  );
}

function quotaReason(input: { group: QueueGroup; reserve: number; free: number }): string {
  if (input.group === 1) return 'fora dos mercados: busca só com sobra da cota';
  if (input.group === 2) return 'rendimento zero recorrente: busca só com sobra da cota';
  if (input.reserve > 0 && input.free + input.reserve > 0)
    return `busca reservada para jogos de prioridade maior do dia (${input.reserve} consultas)`;
  return 'balde de busca do YouTube esgotado';
}

export async function runRelatedAgent(db: Database, opts: RelatedRunOptions): Promise<RelatedRunReport> {
  const now = opts.now ?? new Date();
  const quotaDay = youtubeQuotaDay(now);
  const limits = bucketLimits({
    searchDaily: opts.searchDailyQuota ?? DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA,
    apiDaily: opts.dailyQuota ?? DEFAULT_YOUTUBE_DAILY_QUOTA,
    reservePercent: opts.reservePercent ?? DEFAULT_QUOTA_RESERVE_PERCENT,
  });
  const used = await quotaUsage(db, quotaDay);
  const state: QuotaState = {
    search: { limit: limits.search, used: used.search },
    api: { limit: limits.api, used: used.api },
  };
  const policy = opts.policy ?? relatedPolicyFromEnv();
  const report: RelatedRunReport = {
    items: [],
    quotaDay,
    quota: {
      search: { limit: limits.search, usedBefore: used.search, spent: 0, reserved: 0 },
      api: { limit: limits.api, usedBefore: used.api, spent: 0 },
    },
    idle: 0,
    llmCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    expired: 0,
  };
  if (!opts.plan) {
    if (!opts.youtube) throw new Error('Cliente do YouTube ausente (YOUTUBE_API_KEY).');
    report.expired = (await purgeYoutubeData(db, { now })).rows;
  }
  const maxTier = opts.maxTier ?? 2;
  const ctx = await priorityContext(db, {
    now,
    policy,
    wtw: opts.wtw,
    ...(opts.yieldRows ? { yieldRows: opts.yieldRows } : {}),
  });
  const candidates = opts.eventId
    ? await gameFacts(db, { ...ctx, conds: [inArray(event.id, [opts.eventId])] })
    : rankRelatedCandidates(
        await gameFacts(db, {
          ...ctx,
          conds: [
            eq(event.sport, 'football'),
            eq(event.status, 'finished'),
            gte(
              event.startsAt,
              new Date(now.getTime() - (opts.lookbackHours ?? policy.lookbackHours) * 3_600_000),
            ),
            lte(event.startsAt, now),
            lte(competition.tier, maxTier),
          ],
        }),
        policy.minRelevance,
      ).slice(0, opts.limit ?? 60);
  const upcoming = await upcomingGames(db, { now, maxTier, policy, ctx });
  const reserveCap = { upcoming, searchLimit: state.search.limit, capPercent: policy.reserveMaxPercent };
  report.quota.search.reserved = totalReserve(reserveCap);
  const yt = opts.plan ? null : opts.youtube!;
  const book = new ChannelBook(db, yt, {
    now,
    ...(opts.channelMinSubscribers !== undefined ? { minSubscribers: opts.channelMinSubscribers } : {}),
  });
  const skipped: RelatedSkippedGame[] = [];
  const researchMs = (opts.researchHours ?? DEFAULT_RESEARCH_HOURS) * 3_600_000;

  for (const cand of candidates) {
    const id = cand.id;
    const hasChannels = policy.channelsFirst && (cand.channelLinks > 0 || cand.holderChannels);
    const reserve = reserveFor({ ...reserveCap, score: cand.score, group: cand.group });
    // logo depois do apito a busca ainda não acha os melhores momentos: só os canais oficiais
    const tooEarly =
      !opts.force && now.getTime() < cand.startsAt.getTime() + policy.searchAfterKickoffMinutes * 60_000;
    const quotaAllowance = searchAllowance({
      search: state.search,
      reserve,
      maxSearchesPerRun: policy.maxSearchesPerRun,
      maxSearchesPerEvent: policy.maxSearchesPerEvent,
      searchesSoFar: cand.searchesSoFar,
      zeroYield: cand.group === 2,
    });
    const allowance = tooEarly ? 0 : quotaAllowance;
    const fullDue =
      !!opts.force ||
      fullSearchDue({
        fullRuns: cand.fullRuns,
        lastFull: cand.lastFull ?? (cand.fullRuns ? await lastFullRun(db, id) : null),
        now,
        researchMs,
        secondSearchMs: policy.secondSearchMinutes * 60_000,
      });
    const searchesLeft = cand.searchesSoFar < policy.maxSearchesPerEvent;
    const quotaSkip =
      fullDue && !tooEarly && quotaAllowance === 0 && searchesLeft && policy.maxSearchesPerRun > 0;
    const mode: RelatedMode | null =
      opts.force && (allowance > 0 || hasChannels)
        ? 'full'
        : nextMode({
            fullDue,
            searchAllowance: allowance,
            hasChannels,
            hasAlive: cand.alive > 0,
            lastChannels: cand.lastChannels,
            lastAny: cand.lastAny,
            now,
            channelRefreshMs: policy.channelRefreshMinutes * 60_000,
            revalidateMs: policy.revalidateMinutes * 60_000,
          });
    // jogo sem busca e sem canal com cota esgotada, ou jogo em dia: nenhuma chamada nesta execução
    if (!mode && !quotaSkip) {
      report.idle++;
      continue;
    }
    // balde geral: o jogo só entra com folga para o custo mínimo dele (videos.list + channels.list e uma
    // página de uploads por canal conhecido); o teto do cliente (abaixo) segura o resto
    const minUnits = mode === 'revalidate' ? 2 : mode ? 2 + cand.channelLinks : 1;
    if (state.api.limit - state.api.used < minUnits) {
      report.idle++;
      continue;
    }
    const core = await loadEventCore(db, id);
    if (!core) {
      report.items.push({
        eventId: id,
        label: '?',
        startsAt: '',
        action: 'skipped',
        reason: 'evento não encontrado',
      });
      continue;
    }
    const item: RelatedRunItem = {
      eventId: id,
      label: eventMatchLabel(core),
      startsAt: core.startsAt.toISOString(),
      action: 'skipped',
      relevance: cand.relevance,
      score: cand.score,
      group: cand.group,
    };
    report.items.push(item);
    const free = state.search.limit - state.search.used - reserve;
    if (quotaSkip) {
      item.quotaSkip = true;
      skipped.push({
        eventId: id,
        label: item.label,
        competition: cand.competitionSlug,
        relevance: cand.relevance,
        score: cand.score,
        reason: quotaReason({ group: cand.group, reserve, free }),
        at: now.toISOString(),
      });
    }
    if (!mode) {
      item.reason = quotaReason({ group: cand.group, reserve, free });
      continue;
    }
    if (tooEarly && fullDue) item.reason = 'busca depois do apito: por ora, só os canais oficiais';
    try {
      if (core.status !== 'finished') {
        item.reason = `evento ainda não encerrado (${core.status})`;
        continue;
      }
      item.mode = mode;
      const current = await currentRelatedRows(db, id);
      const alive = current.filter((r) => r.status !== 'retracted' && r.status !== 'expired');

      const final =
        core.score && typeof core.score.home === 'number' && typeof core.score.away === 'number'
          ? { home: core.score.home, away: core.score.away }
          : null;
      const goals = final ? buildGoals(await loadIncidents(db, id), core, final) : [];
      const scorers = [
        ...new Set(goals.filter((g) => g.type !== 'own_goal' && g.scorer).map((g) => g.scorer!)),
      ];
      // idiomas dos mercados em que o jogo pesa (Flamengo x Estudiantes → pt-BR e es-AR; Remo x Cruzeiro só
      // pt-BR); sem mercado relevante (ex.: --evento), o país dos times
      const languages =
        languagesForMarkets(searchMarkets(cand, policy), policy.minRelevance) ??
        languagesFor(await teamCountries(db, core));
      const queries: RelatedQuery[] =
        mode === 'full'
          ? capQueries(
              buildRelatedQueries({
                core,
                scorers,
                languages,
                ...(opts.maxSearchesPerLanguage !== undefined
                  ? { maxPerLanguage: opts.maxSearchesPerLanguage }
                  : {}),
              }),
              Math.max(0, policy.maxSearchesPerEvent - cand.searchesSoFar),
            )
          : [];
      const countries = await teamCountries(db, core);
      const markets = [...new Set([...countries.filter((c): c is string => !!c), 'BR'])];
      const holders = rightsHoldersFor(opts.wtw, core.competition?.slug, markets, core.startsAt);
      const channelScope: ChannelScope = {
        participantIds: [core.home.id, core.away.id],
        teams: [
          { names: teamVariants(core.home), country: countries[0] ?? null },
          { names: teamVariants(core.away), country: countries[1] ?? null },
        ],
        competitionId: core.competition?.id ?? null,
        competitionSlug: core.competition?.slug ?? null,
      };
      const channelQuery = {
        participantIds: [core.home.id, core.away.id],
        competitionId: core.competition?.id ?? null,
        holders: rightsHoldersFor(opts.wtw, core.competition?.slug, policy.markets, core.startsAt),
        markets: policy.markets,
      };

      if (opts.plan) {
        // canal bloqueado (recusas do player ou painel) não é lido: não entra na estimativa
        const blockedChannels = (await readPlaybackBlocks(db)).channels;
        const known = (hasChannels && mode !== 'revalidate' ? await book.linksFor(channelQuery) : []).filter(
          (c) => !blockedChannels.has(c.channelId),
        );
        const planned = queries.slice(0, allowance);
        item.action = 'planned';
        item.queries = planned.map((q) => `${q.language}:${q.label}`);
        item.searches = planned.length;
        item.channels = known.length;
        item.units = known.length + 2;
        item.reason =
          [
            known.length ? `${known.length} canal(is) conhecido(s)` : '',
            planned.map((q) => q.params.q).join(' · '),
            mode === 'revalidate' ? `revalidar ${alive.length} vídeo(s)` : '',
          ]
            .filter(Boolean)
            .join(' · ') || 'nada a buscar';
        // o plano simula o consumo para os jogos seguintes enxergarem o saldo
        state.search.used += planned.length;
        continue;
      }

      const client = yt!;
      const searchStart = client.searchCalls;
      const unitsStart = client.units;
      // nenhuma requisição do balde geral passa do que sobra no dia (a checagem acima é só por jogo)
      client.unitCeiling = unitsStart + Math.max(0, state.api.limit - state.api.used);
      const [run] = await db
        .insert(relatedRun)
        .values({ eventId: id, mode, quotaDay, requestedBy: opts.requestedBy ?? 'cli', startedAt: now })
        .returning({ id: relatedRun.id });
      const runId = run!.id;
      const stats: Record<string, unknown> = { queries: {}, discarded: {} as Record<string, number> };
      const discard = (reason: string) => {
        const d = stats.discarded as Record<string, number>;
        d[reason] = (d[reason] ?? 0) + 1;
      };
      const spent = () => ({ search: client.searchCalls - searchStart, api: client.units - unitsStart });
      try {
        const found = new Map<
          string,
          { labels: Set<string>; language: string | null; region: string | null }
        >();
        const add = (videoId: string, label: string, language: string | null, region: string | null) => {
          const f = found.get(videoId) ?? { labels: new Set<string>(), language, region };
          f.labels.add(label);
          found.set(videoId, f);
        };
        const details = new Map<string, VideoDetail>();
        const requested = new Set<string>();
        const fetchDetails = async (ids: readonly string[]) => {
          const want = [...new Set(ids)].filter((x) => !requested.has(x));
          for (const x of want) requested.add(x);
          if (want.length) for (const v of await client.videos(want)) details.set(v.id, v);
        };
        const channelsOf = async (vs: readonly VideoDetail[]) => book.details(vs.map((v) => v.channelId));
        const tierOf = (v: VideoDetail, chans: Map<string, ChannelDetail>) => {
          const ch = chans.get(v.channelId) ?? {
            id: v.channelId,
            title: v.channelTitle,
            handle: null,
            subscribers: null,
          };
          return opts.allowlist.classify(ch, holders, channelScope);
        };
        const usable = (v: VideoDetail, chans: Map<string, ChannelDetail>) => {
          const verdict = tierOf(v, chans);
          if (verdict.blocked) return null;
          const rel = checkRelevance(core, {
            title: v.title,
            description: v.description,
            tags: v.tags,
            publishedAt: new Date(v.publishedAt),
            privacyStatus: v.privacyStatus,
            embeddable: v.embeddable,
            tier: verdict.tier,
            clubChannel: verdict.tier === 'official' && verdict.entry?.kind === 'club',
          });
          return rel.ok ? verdict.tier : null;
        };

        // vídeos que o player oficial recusou e canais fora (no limiar de recusas ou bloqueados no painel): a
        // coleta os pula ANTES de gastar cota (playlistItems, videos.list, channels.list)
        const blocks = await readPlaybackBlocks(db);
        const skipped = { channels: 0, videos: 0 };
        const blockedHit = (videoId: string, channelId: string | null) => {
          const out = blocks.videos.has(videoId) || (!!channelId && blocks.channels.has(channelId));
          if (out) skipped.videos++;
          return out;
        };

        // 1. canais conhecidos (clubes, competição, emissoras): 1 unidade por página de uploads
        let channelUsable = 0;
        if (mode !== 'revalidate' && hasChannels) {
          // canal bloqueado sai antes do channels.list (detalhe do canal) e do playlistItems
          const links = await book.linksFor(channelQuery);
          skipped.channels = links.filter((l) => blocks.channels.has(l.channelId)).length;
          const known = await book.knownChannels(channelQuery, blocks.channels);
          item.channels = known.length;
          let matches = 0;
          for (const ch of known) {
            const uploads = await book.recentUploads(ch.uploadsPlaylistId, core.startsAt);
            const side =
              ch.kind === 'club'
                ? ch.participantId === core.home.id
                  ? 'home'
                  : ch.participantId === core.away.id
                    ? 'away'
                    : null
                : null;
            for (const m of matchUploads(uploads, {
              kickoff: core.startsAt,
              home: core.home,
              away: core.away,
              kind: ch.kind,
              side,
            })) {
              if (blockedHit(m.videoId, ch.channelId)) continue;
              add(m.videoId, `${CHANNEL_QUERY_PREFIX}${ch.kind}`, null, null);
              matches++;
            }
          }
          stats.channels = { read: known.length, matches };
          await fetchDetails([...found.keys()]);
          const chans = await channelsOf([...details.values()]);
          channelUsable = [...details.values()].filter((v) => {
            const tier = usable(v, chans);
            return tier === 'official' || tier === 'rights_holder';
          }).length;
          stats.channelUsable = channelUsable;
        }

        // 2. busca: só complemento — dispensada quando os canais bastam; para na primeira sem vídeo novo
        //    aproveitável; teto por execução e por jogo; cada consulta sai do balde de ~100/dia
        let searches = 0;
        if (mode === 'full') {
          if (channelUsable >= policy.channelEnough) stats.searchSkipped = 'channels_enough';
          else if (!queries.length || allowance === 0) stats.searchSkipped = queries.length ? 'quota' : 'cap';
          for (const q of channelUsable >= policy.channelEnough ? [] : queries) {
            if (searches >= allowance) break;
            if (found.size >= policy.maxVideos * 3) {
              stats.stoppedEarly = 'enough_candidates';
              break;
            }
            let hits;
            try {
              hits = await client.search(q.params);
            } catch (err) {
              if ((err as { quotaExceeded?: boolean }).quotaExceeded) {
                stats.quotaExceeded = true;
                state.search.used = state.search.limit;
                break;
              }
              throw err;
            }
            searches++;
            // a busca não exclui canal: o que vier de vídeo ou canal bloqueado nem vai para o videos.list
            const allowedHits = hits.filter(
              (h) => found.has(h.videoId) || !blockedHit(h.videoId, h.channelId),
            );
            const fresh = allowedHits.map((h) => h.videoId).filter((v) => !found.has(v));
            (stats.queries as Record<string, unknown>)[`${q.language}:${q.label}`] = {
              q: q.params.q,
              hits: hits.length,
              new: fresh.length,
            };
            for (const h of allowedHits)
              add(h.videoId, `${q.language}:${q.label}`, q.language, q.params.regionCode ?? null);
            await fetchDetails(fresh);
            const newVideos = fresh.flatMap((v) => (details.has(v) ? [details.get(v)!] : []));
            const chans = await channelsOf(newVideos);
            const ok = newVideos.filter((v) => usable(v, chans) !== null).length;
            (stats.queries as Record<string, Record<string, unknown>>)[`${q.language}:${q.label}`]!.usable =
              ok;
            if (!ok) {
              stats.stoppedEarly = 'no_usable';
              break;
            }
          }
        }
        // 3. detalhe dos guardados (o que sumiu vira retracted). O guardado bloqueado não é relido (não gasta cota)
        //    nem retirado: a leitura já o tira da vitrine, e ele volta sozinho se o bloqueio for desfeito
        const prevById = new Map<string, RelatedContentRow>(alive.map((r) => [r.externalId, r]));
        const prevBlocked = new Set(
          [...prevById.values()]
            .filter((r) => blocks.videos.has(r.externalId) || blocks.channels.has(r.channelId))
            .map((r) => r.externalId),
        );
        await fetchDetails([...prevById.keys()].filter((x) => !prevBlocked.has(x)));
        const videos = [...details.values()].filter((v) => found.has(v.id) || prevById.has(v.id));
        const gone = [...prevById.keys()].filter((x) => !details.has(x) && !prevBlocked.has(x));
        stats.blockedSkipped = { ...skipped, stored: prevBlocked.size };
        const channels = await channelsOf(videos);

        // 4. canal + relevância (código)
        type Cand = {
          v: VideoDetail;
          tier: ReturnType<ChannelAllowlist['classify']>;
          prev?: RelatedContentRow;
        };
        const cands: Cand[] = [];
        // o que passou pelo filtro de antes (ex.: bloqueado no meio da execução) e o histórico por canal e formato
        for (const v of videos) {
          if (blocks.videos.has(v.id)) {
            discard('playback_blocked');
            continue;
          }
          if (blocks.channels.has(v.channelId)) {
            discard('channel_playback_blocked');
            continue;
          }
          const verdict = tierOf(v, channels);
          // blocklist editorial (arquivo): o que já estava publicado sai na hora. As recusas do player e o
          // bloqueio do painel já ficam fora na leitura e voltam sozinhos quando liberados: não são retirados
          if (verdict.blocked) {
            discard('blocked_channel');
            if (prevById.has(v.id)) gone.push(v.id);
            continue;
          }
          const rel = checkRelevance(core, {
            title: v.title,
            description: v.description,
            tags: v.tags,
            publishedAt: new Date(v.publishedAt),
            privacyStatus: v.privacyStatus,
            embeddable: v.embeddable,
            tier: verdict.tier,
            clubChannel: verdict.tier === 'official' && verdict.entry?.kind === 'club',
          });
          if (!rel.ok) {
            discard(rel.reason);
            // um time só: por tier, para acompanhar o que a regra (só no canal do clube) passou a cortar
            if (rel.reason === 'one_team_only') {
              const byTier = (stats.oneTeamOnly ??= {}) as Record<string, number>;
              byTier[verdict.tier] = (byTier[verdict.tier] ?? 0) + 1;
            }
            if (prevById.has(v.id)) gone.push(v.id);
            continue;
          }
          cands.push({ v, tier: verdict, ...(prevById.has(v.id) ? { prev: prevById.get(v.id)! } : {}) });
        }

        // 5. classificação: novos, os que mudaram de título e (com LLM) os que só tinham a das regras;
        //    o resto reaproveita a anterior
        const toClassify = cands.filter(
          (c) =>
            !c.prev ||
            c.prev.title !== sanitizeText(c.v.title, 300) ||
            (!!opts.llm && c.prev.classifiedBy === RULES_CLASSIFIER),
        );
        const cls = await classifyVideos({
          llm: opts.llm,
          eventId: id,
          facts: classifyFacts(core, scorers),
          videos: toClassify.map((c) => ({
            id: c.v.id,
            title: c.v.title,
            description: c.v.description,
            channelTitle: c.v.channelTitle,
            durationSeconds: c.v.durationSeconds,
            format: detectFormat(c.v),
            tags: c.v.tags,
          })),
        });
        report.llmCalls += cls.llmCalls;
        report.usage.inputTokens += cls.usage.inputTokens;
        report.usage.outputTokens += cls.usage.outputTokens;
        report.usage.costUsd += cls.usage.costUsd ?? 0;
        item.llm = !!cls.model && !cls.error;
        if (cls.error) stats.llmError = cls.error.slice(0, 300);

        // 6. política + ranking
        const items: RelatedItemInput[] = [];
        for (const c of cands) {
          const { v } = c;
          const ch = channels.get(v.channelId);
          const fresh = cls.byId.get(v.id);
          const prevFlags = (c.prev?.flags ?? []).filter((f) => f === 'injection_signal');
          // reaproveita a classificação anterior (inclusive o "não é deste jogo" do LLM)
          const base = fresh ?? {
            type: c.prev!.contentType,
            confidence: Number(c.prev!.confidence),
            aboutThisEvent: !c.prev!.flags.includes('not_this_event'),
            classifiedBy: c.prev!.classifiedBy,
            flags: prevFlags,
          };
          // idioma e país do vídeo (es-AR, pt-BR…): o país do canal quando fala o idioma, senão o da busca
          const language = videoLocale({
            language: v.defaultLanguage?.slice(0, 2) ?? found.get(v.id)?.language ?? c.prev?.language ?? null,
            channelCountry: ch?.country ?? null,
            queryRegion: found.get(v.id)?.region ?? c.prev?.language?.slice(3) ?? null,
          });
          const locale = language?.startsWith('es') ? 'es-AR' : 'pt-BR';
          const flags = [...base.flags];
          if (findForbiddenTerms(v.title, locale, { allowPhrases: [core.home.name, core.away.name] }).length)
            flags.push('offensive_title');
          const format = detectFormat(v);
          const decision = base.aboutThisEvent
            ? decidePublication({
                tier: c.tier.tier,
                type: base.type,
                confidence: base.confidence,
                format,
                flags,
              })
            : { status: 'rejected' as const, flags: [...flags, 'not_this_event'] };
          const publishedAt = new Date(v.publishedAt);
          items.push({
            externalId: v.id,
            url: videoUrl(v.id, format),
            embedUrl: `https://www.youtube.com/embed/${v.id}`,
            title: sanitizeText(v.title, 300),
            descriptionExcerpt: v.description
              ? sanitizeExcerpt(sanitizeText(v.description, 1000), 200)
              : null,
            channelId: v.channelId,
            channelTitle: sanitizeText(ch?.title || v.channelTitle, 120),
            channelHandle: ch?.handle ?? null,
            sourceTier: c.tier.tier,
            contentType: base.type,
            format,
            aspectRatio: aspectRatioOf(v),
            durationSeconds: v.durationSeconds,
            publishedAt,
            thumbnailUrl: v.thumbnailUrl,
            language,
            regionAllowed: v.regionAllowed,
            regionBlocked: v.regionBlocked,
            statistics: {
              views: v.views,
              likes: v.likes,
              comments: v.comments,
              fetchedAt: now.toISOString(),
            },
            rankScore: rankScore({
              tier: c.tier.tier,
              type: base.type,
              views: v.views,
              publishedAt,
              kickoff: core.startsAt,
              blockedSameChannelFormat: blocks.byChannelFormat.get(`${v.channelId}|${format}`) ?? 0,
            }),
            confidence: base.confidence,
            classifiedBy: base.classifiedBy,
            status: decision.status,
            flags: decision.flags,
            queries: [...(found.get(v.id)?.labels ?? [])],
          });
        }

        // teto de vídeos por jogo e idioma: o excedente fica fora da vitrine (pending + over_limit)
        capPublished(items, policy.maxVideos);
        const saved = await saveRelatedContent(db, {
          eventId: id,
          provider: 'youtube',
          items,
          gone: [...new Set(gone)],
          runId,
          sport: core.sport,
          competitionId: core.competition?.id ?? null,
          now,
        });
        const published = items.filter((i) => i.status === 'published');
        const fromChannel = (i: RelatedItemInput) =>
          i.queries.some((q) => q.startsWith(CHANNEL_QUERY_PREFIX));
        const fromSearch = (i: RelatedItemInput) =>
          i.queries.some((q) => !q.startsWith(CHANNEL_QUERY_PREFIX));
        stats.publishedFrom = {
          channels: published.filter(fromChannel).length,
          search: published.filter(fromSearch).length,
        };
        item.action = mode === 'full' ? 'searched' : mode === 'channels' ? 'channels' : 'revalidated';
        item.candidates = videos.length;
        item.published = published.length;
        item.pending = items.filter((i) => i.status === 'pending').length;
        item.rejected = items.filter((i) => i.status === 'rejected').length;
        item.types = published.reduce<Record<string, number>>((acc, i) => {
          acc[i.contentType] = (acc[i.contentType] ?? 0) + 1;
          return acc;
        }, {});
        item.queries = Object.keys(stats.queries as object);
        const cost = spent();
        item.searches = cost.search;
        item.units = cost.api;
        state.search.used += cost.search;
        state.api.used += cost.api;
        report.quota.search.spent += cost.search;
        report.quota.api.spent += cost.api;
        stats.saved = saved;
        await db
          .update(relatedRun)
          .set({
            status: 'done',
            finishedAt: new Date(),
            quotaUnits: cost.search + cost.api,
            apiUnits: cost.api,
            searches: cost.search,
            candidates: videos.length,
            published: published.length,
            provider: cls.provider,
            model: cls.model,
            inputTokens: cls.usage.inputTokens,
            outputTokens: cls.usage.outputTokens,
            costUsd: cls.usage.costUsd !== undefined ? cls.usage.costUsd.toFixed(6) : null,
            stats,
          })
          .where(eq(relatedRun.id, runId));
      } catch (err) {
        const cost = spent();
        state.search.used += cost.search;
        state.api.used += cost.api;
        report.quota.search.spent += cost.search;
        report.quota.api.spent += cost.api;
        await db
          .update(relatedRun)
          .set({
            status: 'failed',
            finishedAt: new Date(),
            quotaUnits: cost.search + cost.api,
            apiUnits: cost.api,
            searches: cost.search,
            error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
            stats,
          })
          .where(eq(relatedRun.id, runId));
        throw err;
      }
    } catch (err) {
      item.action = 'error';
      item.reason = err instanceof Error ? err.message : String(err);
    }
  }

  if (!opts.plan) {
    const upcomingRows: RelatedUpcomingGame[] = upcoming.slice(0, 50).map((u) => ({
      eventId: u.id,
      startsAt: u.startsAt.toISOString(),
      score: u.score,
      reserved: u.expected,
    }));
    await saveRelatedBudget(db, {
      quotaDay,
      searchLimit: state.search.limit,
      searchUsed: state.search.used,
      searchReserved: report.quota.search.reserved,
      apiLimit: state.api.limit,
      apiUsed: state.api.used,
      skipped,
      upcoming: upcomingRows,
      now,
    });
  }
  return report;
}
