import {
  requestHash,
  ttlFor,
  type ApiSport,
  type PlanLimits,
  type PlanRules,
  type ProviderStatus,
} from '@galaxie/apisports-client';
import { isInPlay, mapFootballStatus } from '@galaxie/providers';
import {
  compareCompetitions,
  covers,
  type CatalogSource,
  type CompetitionInfo,
  type SeasonInfo,
} from './catalog-source.js';
import { buildDetailRequests, selectDetailFixtures, splitDone } from './details-job.js';
import { collectFixtures, dateList } from './fixtures.js';
import {
  buildPersonRequests,
  PERSON_ENDPOINTS,
  peopleOfTeams,
  TEAM_ENDPOINTS,
  teamTargets,
} from './people-job.js';
import { cursorId, type CursorRef, type CursorStore } from './runtime/cursor-store.js';
import type { RawSource } from './runtime/raw-source.js';
import { plannedRequest, type AfterFetch, type JobSpec, type PlannedRequest } from './runtime/runner.js';
import { seasonAccessible } from './seasons-job.js';

const DAY_MS = 86_400_000;
/** Jogo que começou há mais que isto já acabou (futebol: ~2 h, com prorrogação e pênaltis ~2h40). */
const SURELY_OVER_MS = 6 * 3_600_000;

/** Agenda diária das outras 11 APIs (cada uma com cota própria): 1 chamada = todas as ligas do dia. */
export const OTHER_SPORTS_SCHEDULE: Record<Exclude<ApiSport, 'football'>, string> = {
  afl: '/games',
  baseball: '/games',
  basketball: '/games',
  'formula-1': '/races',
  handball: '/games',
  hockey: '/games',
  mma: '/fights',
  nba: '/games',
  'american-football': '/games',
  rugby: '/games',
  volleyball: '/games',
};

/**
 * Período do rodízio por endpoint: o cursor mais antigo que isso volta para a fila. `/sidelined` a cada 2 dias (o
 * histórico de lesões é o que diz se o desfalque ainda vale; decisão do dono em 07/11) e `/transfers` a cada 7
 * (janela de transferências muda o elenco de uma semana para a outra).
 */
export const ROTATION_PERIOD_DAYS: Record<string, number> = {
  '/players/squads': 7,
  '/coachs': 30,
  '/transfers': 7,
  '/trophies': 30,
  '/sidelined': 2,
};

/**
 * Chamadas do rodízio de pessoas tier 1 por dia nos planos pagos. Regime (cerca de 850 times e 25 mil pessoas
 * tier 1, lotes de 20): elencos 850/7 ≈ 120, transferências 850/7 ≈ 120, técnicos 850/30 ≈ 30, títulos
 * 1.300/30 ≈ 45, afastamentos 1.300/2 ≈ 650; ≈ 965/dia. A folga cobre a primeira passada e elenco novo.
 */
export const PAID_ROTATION_LIMIT = 1500;

/** Partidas detalhadas por dia nos planos pagos (`fixtures?ids=`, 20 por chamada): até 100 chamadas. */
export const PAID_MAX_DETAILS = 2000;

/**
 * Período da relista da temporada atual (`fixtures?league&season`) por tier: tier 1 a cada 2 dias (remarcação e
 * chaveamento de copa aparecem antes da véspera), os demais a cada 7.
 */
export const SEASON_LIST_PERIOD_DAYS: Record<number, number> = { 1: 2 };
const SEASON_LIST_DEFAULT_PERIOD_DAYS = 7;
/** Temporada em jogo: começa em até 14 dias (o calendário já sai) e não terminou há mais de 7. */
const SEASON_LIST_AHEAD_DAYS = 14;
const SEASON_LIST_AFTER_END_DAYS = 7;

export interface DailyOptions {
  /**
   * Máximo de partidas detalhadas por dia (padrão: 35 no free, 2.000 nos pagos, até 100 chamadas de 20). Os tiers
   * 1 a 3 somam cerca de 480 encerrados por dia e até 1.400 no fim de semana (medido em 12/11/2026).
   */
  maxDetails?: number | undefined;
  /** Dias para trás varridos em busca de encerrados sem detalhe (padrão 3: D-1, D-2, D-3). */
  backlogDays?: number | undefined;
  /** Chamadas do rodízio de entidades por dia (padrão: 5 no free, PAID_ROTATION_LIMIT nos pagos). */
  rotation?: number | undefined;
  /** Também busca injuries?date=D+1. */
  injuriesTomorrow?: boolean | undefined;
  /** Agenda das outras 11 APIs (games/races/fights?date=). */
  otherSports?: boolean | undefined;
  /** Maior tier com detalhe dos encerrados (padrão 3: todo o catálogo, decisão do dono em 12/11/2026). */
  maxTier?: number | undefined;
  /** Relistas da temporada atual por dia (padrão: 0 no free, que não alcança a temporada atual; 300 nos pagos). */
  seasonLists?: number | undefined;
  /** Maior tier com a temporada atual relistada (padrão 3: todo o catálogo). */
  seasonListTier?: number | undefined;
  /** Páginas de `players?league&season` por dia (padrão: 0 no free, 1000 nos pagos); 0 desliga. */
  playerStats?: number | undefined;
  /** Maior tier com os números dos jogadores renovados (padrão 3: todo o catálogo, decisão do dono em 12/11/2026). */
  playerStatsTier?: number | undefined;
  /** `--forcar`: a relista ignora o período do cursor (ex.: remarcação urgente), ainda dentro do limite do dia. */
  force?: boolean | undefined;
}

export function utcDate(d: Date, offsetDays = 0): string {
  return new Date(d.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isPaid(plan: PlanRules): boolean {
  return !plan.current.forbiddenParams.includes('ids');
}

/**
 * Passo fixo do dia: agenda mundial de ontem, hoje e amanhã, desfalques do dia e /leagues (novas temporadas
 * e cobertura). Cada item vale uma vez por dia UTC — reexecutar no mesmo dia não gasta cota de novo.
 */
export function buildScheduleRequests(now: Date, opts: DailyOptions = {}): PlannedRequest[] {
  const staleBefore = startOfUtcDay(now);
  const out: PlannedRequest[] = [-1, 0, 1].map((o) =>
    plannedRequest('fixtures-data', 'football', '/fixtures', { date: utcDate(now, o) }, { staleBefore }),
  );
  for (const o of opts.injuriesTomorrow ? [0, 1] : [0]) {
    out.push(
      plannedRequest('injuries-data', 'football', '/injuries', { date: utcDate(now, o) }, { staleBefore }),
    );
  }
  out.push(plannedRequest('leagues', 'football', '/leagues', {}, { staleBefore }));
  if (opts.otherSports) {
    for (const [sport, endpoint] of Object.entries(OTHER_SPORTS_SCHEDULE)) {
      for (const o of [-1, 0, 1]) {
        out.push(
          plannedRequest(
            'outros-esportes',
            sport as ApiSport,
            endpoint,
            { date: utcDate(now, o) },
            { staleBefore },
          ),
        );
      }
    }
  }
  return out;
}

/**
 * Agenda de anteontem gravada com jogo ainda em andamento: o sync das 00:05 grava `fixtures?date=D-1` com os
 * jogos que começaram depois das ~22h UTC no meio, e essa lista não era mais buscada (D-2 tem TTL eterno no
 * raw) — o jogo ficava em andamento no raw e nunca recebia detalhe. Rebusca a lista de D-2 (1 chamada,
 * uma vez por dia) só quando ela tem jogo em andamento (`isInPlay`: inclui intervalo e suspenso/interrompido,
 * que pode ter sido retomado); o detalhe dos encerrados vem na fase seguinte, que também aceita o jogo que a
 * lista deixou em andamento mas já deveria ter acabado (`isStaleOpen`, sem os suspensos).
 */
export async function reopenUnfinishedDay(
  raw: RawSource,
  now: Date,
  plan: PlanRules,
): Promise<PlannedRequest[]> {
  // plano com date= só em hoje ± 1 (free): a lista de D-2 é bloqueada; o detalhe por id cobre (fase seguinte)
  const window = plan.current.dateWindowDays;
  if (window !== undefined && window < 2) return [];
  const date = utcDate(now, -2);
  const open = (await collectFixtures(raw, [dateList(date)])).filter((f) => {
    const status = mapFootballStatus(f.status);
    return status != null && isInPlay(status);
  });
  if (!open.length) return [];
  return [
    plannedRequest(
      'fixtures-data',
      'football',
      '/fixtures',
      { date },
      // a lista de D-2 nunca expira no raw: sem maxAgeMs = 0 o cliente serviria a gravada
      { staleBefore: startOfUtcDay(now), maxAgeMs: 0 },
    ),
  ];
}

/**
 * Rodízio de entidades dos times tier 1: escolhe os itens cujo cursor está mais velho que o período
 * (nunca buscados primeiro), até o limite do dia. Usa os mesmos cursores do bootstrap:people.
 * O limite vale por dia UTC: o que já foi renovado hoje desconta (reexecutar não gasta de novo).
 */
export async function buildRotationRequests(
  candidates: PlannedRequest[],
  cursors: CursorStore,
  now: Date,
  limit: number,
  periodDays: (item: PlannedRequest) => number = (item) => ROTATION_PERIOD_DAYS[item.endpoint] ?? 30,
  /**
   * Fatia pelo ritmo: com a chave (o endpoint, no rodízio de pessoas), cada chave recebe primeiro a vaga diária
   * que o período dela pede (itens ÷ período: 1.300 lotes de `/sidelined` a cada 2 dias = 650/dia) e a sobra vai
   * em revezamento, cada chave na sua ordem de idade. Sem isso o endpoint que vem primeiro na lista leva o dia
   * inteiro enquanto tiver item nunca buscado (o `/trophies` de 25 mil pessoas deixava o `/sidelined` sem busca).
   */
  shareBy?: (item: PlannedRequest) => string,
): Promise<PlannedRequest[]> {
  const states = await cursors.load(candidates.flatMap((c) => c.cursors));
  const today = startOfUtcDay(now).getTime();
  // vaga diária de cada chave pelo ritmo (todos os candidatos dela ÷ período), antes de descontar o que já foi hoje
  const need = new Map<string, number>();
  if (shareBy)
    for (const item of candidates) {
      const k = shareBy(item);
      need.set(k, (need.get(k) ?? 0) + 1 / periodDays(item));
    }
  const aged: { item: PlannedRequest; age: number }[] = [];
  let renewedToday = 0;
  for (const item of candidates) {
    // corte por dia UTC, não por N × 24 h exatas (como no espelho): o item buscado anteontem, a qualquer hora, vence
    // hoje no período de 2 dias; com 48 h exatas, o buscado minutos depois do build de anteontem esperava mais um dia
    const staleBefore = new Date(today - (Math.max(1, periodDays(item)) - 1) * DAY_MS);
    const times = item.cursors.map((c) => states.get(cursorId(c))?.completedAt?.getTime() ?? -Infinity);
    const age = Math.min(...times);
    if (age >= today) {
      renewedToday += 1;
      // a vaga do ritmo vale por dia e por chave: reexecutar no mesmo dia desconta o que esta chave já renovou
      if (shareBy) need.set(shareBy(item), (need.get(shareBy(item)) ?? 0) - 1);
    }
    if (age >= staleBefore.getTime()) continue;
    // o raw mais velho que o corte não serve: sem isso o runner usava só o TTL do endpoint (7 dias nas pessoas) e o
    // /sidelined de 2 dias saía do cache até a resposta fazer 7 dias; o TTL menor (relista: 1 h) continua valendo
    const maxAgeMs = Math.min(ttlFor(item.endpoint, item.params, now), now.getTime() - staleBefore.getTime());
    aged.push({ item: { ...item, staleBefore, maxAgeMs }, age });
  }
  limit = Math.max(0, limit - renewedToday);
  // estável: em empate, mantém a ordem de prioridade dos candidatos (squads tier 1 primeiro)
  const sorted = aged
    .map((a, i) => ({ ...a, i }))
    .sort((a, b) => a.age - b.age || a.i - b.i)
    .map((a) => a.item);
  if (!shareBy) return sorted.slice(0, limit);
  const paced = new Map([...need].map(([k, v]) => [k, Math.max(0, Math.ceil(v))] as const));
  return pacedShare(sorted, shareBy, paced, limit);
}

/**
 * Cada chave leva até a sua vaga (`paced`, proporcional quando a soma passa do limite), na ordem dada e com as
 * chaves em revezamento; o que sobrar do limite vai em revezamento (`roundRobin`) entre as chaves que ainda têm item.
 */
export function pacedShare<T>(
  items: T[],
  key: (item: T) => string,
  paced: Map<string, number>,
  limit: number,
): T[] {
  const total = [...paced.values()].reduce((a, b) => a + b, 0);
  const scale = total > limit ? limit / total : 1;
  const taken = new Map<string, number>();
  const first: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const k = key(item);
    const n = taken.get(k) ?? 0;
    if (n < Math.floor((paced.get(k) ?? 0) * scale) && first.length < limit) {
      taken.set(k, n + 1);
      first.push(item);
    } else rest.push(item);
  }
  // vagas em revezamento: execução cortada no meio (--max-chamadas, cota, erro do fornecedor) não deixa o último
  // endpoint da lista sem nada
  return [...roundRobin(first, key, first.length), ...roundRobin(rest, key, limit - first.length)];
}

/** Revezamento entre as chaves (na ordem da 1ª aparição), cada uma na ordem dada, até o limite. */
export function roundRobin<T>(items: T[], key: (item: T) => string, limit: number): T[] {
  const queues = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const q = queues.get(k);
    if (q) q.push(item);
    else queues.set(k, [item]);
  }
  const lists = [...queues.values()];
  const out: T[] = [];
  for (let round = 0; out.length < limit; round += 1) {
    let any = false;
    for (const q of lists) {
      if (round >= q.length) continue;
      any = true;
      out.push(q[round]!);
      if (out.length >= limit) break;
    }
    if (!any) break;
  }
  return out;
}

export const SEASON_LIST_STEP = 'temporada-atual';

/**
 * Liga e ano de uma relista da temporada atual (o sync recalcula a tabela dessas temporadas: o recálculo por
 * resultado novo só olha jogos dos últimos dias, e a relista traz justamente os antigos que faltavam).
 */
export function seasonListPair(item: PlannedRequest): { league: string; year: number } | undefined {
  if (item.step !== SEASON_LIST_STEP || !item.params.league || !item.params.season) return undefined;
  return { league: String(item.params.league), year: Number(item.params.season) };
}

/**
 * Acompanha as relistas da temporada atual em volta da normalização do sync: as normalizadas entram no recálculo
 * da tabela; a que falhou ou não foi normalizada (`--sem-normalizar`) não (o core ainda é o antigo) e tem o
 * cursor reaberto no fim (`reopenSeasonLists`),
 * para voltar na próxima execução e ser normalizada e recalculada de novo, em vez de esperar o período do tier.
 */
export function trackSeasonLists(normalize?: { afterFetch: AfterFetch; report: () => { errors: number } }): {
  afterFetch: AfterFetch;
  normalized: () => { league: string; year: number }[];
  failed: () => CursorRef[];
} {
  const normalized: { league: string; year: number }[] = [];
  const failed: CursorRef[] = [];
  const afterFetch: AfterFetch = async (envelope, request) => {
    const before = normalize?.report().errors ?? 0;
    await normalize?.afterFetch(envelope, request);
    const pair = seasonListPair(request);
    if (!pair) return;
    // sem normalização (`--sem-normalizar`) o core também não recebeu a lista: volta na próxima execução
    if (!normalize || normalize.report().errors > before) failed.push(...request.cursors);
    else normalized.push(pair);
  };
  return { afterFetch, normalized: () => normalized, failed: () => failed };
}

/** Reabre os cursores das relistas que não normalizaram: concluídos "na época zero", vencem na hora. */
export async function reopenSeasonLists(cursors: CursorStore, refs: CursorRef[]): Promise<void> {
  if (refs.length) await cursors.complete(refs, { normalizeError: true }, new Date(0));
}

/**
 * Relista da temporada atual: `fixtures?league&season` das temporadas em jogo (a atual e a próxima edição que
 * começa em até 14 dias, mesmo antes de virar `current`), no mesmo cursor do
 * bootstrap:seasons. Sem isso a temporada só recebe `fixtures?date=` D-1/D0/D+1 do sync: a que começou depois do
 * bootstrap (ou de tier fora dele) fica só com as rodadas desde que o sync passou a rodar, a tabela calculada sai
 * com 1 a 3 jogos por time, e jogo marcado depois do bootstrap (remarcação, chave de copa) só aparece na véspera.
 * Rodízio por cursor: nunca listada primeiro (na ordem do catálogo), depois a mais velha que o período do tier.
 */
export async function buildSeasonListRequests(
  comps: CompetitionInfo[],
  cursors: CursorStore,
  limits: PlanLimits,
  now: Date,
  limit: number,
  force = false,
): Promise<PlannedRequest[]> {
  const period = new Map<PlannedRequest, number>();
  for (const { competition: c, season: s } of seasonsInPlay(comps, limits, now)) {
    const item = plannedRequest(SEASON_LIST_STEP, 'football', '/fixtures', {
      league: c.leagueId,
      season: s.year,
    });
    period.set(item, SEASON_LIST_PERIOD_DAYS[c.tier] ?? SEASON_LIST_DEFAULT_PERIOD_DAYS);
  }
  if (force) return [...period.keys()].slice(0, limit);
  return buildRotationRequests([...period.keys()], cursors, now, limit, (i) => period.get(i)!);
}

/**
 * Temporadas em jogo, na ordem do catálogo: a atual e a próxima edição que começa em até 14 dias (mesmo antes de
 * virar `current`), até 7 dias depois do fim, só as que o plano alcança.
 */
export function seasonsInPlay(
  comps: CompetitionInfo[],
  limits: PlanLimits,
  now: Date,
): { competition: CompetitionInfo; season: SeasonInfo }[] {
  const startsBy = utcDate(now, SEASON_LIST_AHEAD_DAYS);
  const endedAfter = utcDate(now, -SEASON_LIST_AFTER_END_DAYS);
  const out: { competition: CompetitionInfo; season: SeasonInfo }[] = [];
  for (const c of [...comps].sort(compareCompetitions)) {
    for (const s of c.seasons) {
      // a próxima edição sai no /leagues com calendário antes de virar `current`: vale pela janela de datas
      if (!s.current && !s.startDate) continue;
      if (!seasonAccessible(s.year, limits)) continue;
      if ((s.startDate && s.startDate > startsBy) || (s.endDate && s.endDate < endedAfter)) continue;
      out.push({ competition: c, season: s });
    }
  }
  return out;
}

export const PLAYER_STATS_STEP = 'estatisticas-jogadores';

/**
 * Período da renovação dos números dos jogadores da temporada em jogo (`players?league&season`) por tier: tier 1 a
 * cada 3 dias (uma rodada por semana, às vezes duas), os demais a cada 7. Em 12/11/2026 eram 22 temporadas em jogo no
 * tier 1 (1.007 páginas), 29 no tier 2 (833) e 110 no tier 3 (1.239): cerca de 630 páginas por dia, abaixo das 1.000.
 */
export const PLAYER_STATS_PERIOD_DAYS: Record<number, number> = { 1: 3 };
const PLAYER_STATS_DEFAULT_PERIOD_DAYS = 7;

interface PlayerStatsSeason {
  league: number;
  season: number;
  period: number;
  /** Páginas da última página 1 gravada no raw (`paging.total`); sem página 1 no raw, 1. */
  pages: number;
}

function playerStatsPage(x: { league: number; season: number }, page: number, staleBefore?: Date) {
  return plannedRequest(
    PLAYER_STATS_STEP,
    'football',
    '/players',
    { league: x.league, season: x.season, page },
    staleBefore ? { staleBefore } : {},
  );
}

/** Temporadas em jogo com cobertura de jogadores, com o período do tier e o total de páginas que o raw conhece. */
async function playerStatsSeasons(
  comps: CompetitionInfo[],
  raw: RawSource,
  limits: PlanLimits,
  now: Date,
): Promise<PlayerStatsSeason[]> {
  const today = utcDate(now);
  const wanted = seasonsInPlay(comps, limits, now)
    // a próxima edição entra na relista antes de começar, e no dia da estreia ainda não há jogo encerrado: os
    // números viriam zerados
    .filter(
      (x) => covers(x.season.coverage, 'players') && (!x.season.startDate || x.season.startDate < today),
    )
    .map((x) => ({
      league: x.competition.leagueId,
      season: x.season.year,
      period: PLAYER_STATS_PERIOD_DAYS[x.competition.tier] ?? PLAYER_STATS_DEFAULT_PERIOD_DAYS,
      pages: 1,
    }));
  // só o `paging` da página 1 de cada temporada pedida, pelo request hash (índice do raw), sem o corpo
  const hashOf = (w: PlayerStatsSeason) => {
    const p1 = playerStatsPage(w, 1);
    return requestHash('api-sports', p1.sport, p1.endpoint, p1.params);
  };
  const paging = await raw.latestPaging('football', '/players', wanted.map(hashOf));
  for (const w of wanted) w.pages = Math.max(1, paging.get(hashOf(w))?.total ?? 1);
  return wanted;
}

/** Quantas páginas de estatísticas de jogadores já foram buscadas hoje (o limite vale por dia UTC). */
function spentToday(
  seasons: PlayerStatsSeason[],
  states: Map<string, { completedAt: Date | null }>,
  now: Date,
): number {
  const today = startOfUtcDay(now).getTime();
  let n = 0;
  for (const s of seasons) {
    for (let page = 1; page <= s.pages; page++) {
      const at = states.get(cursorId(playerStatsPage(s, page).cursors[0]!))?.completedAt;
      if (at && at.getTime() >= today) n += 1;
    }
  }
  return n;
}

async function loadPlayerStatsCursors(seasons: PlayerStatsSeason[], cursors: CursorStore) {
  const refs: CursorRef[] = [];
  for (const s of seasons)
    for (let page = 1; page <= s.pages; page++) refs.push(...playerStatsPage(s, page).cursors);
  return cursors.load(refs);
}

/**
 * Números dos jogadores da temporada em jogo, primeira metade: a página 1 de `players?league&season` das temporadas
 * cuja última passada ficou mais velha que o período do tier (nunca buscadas primeiro, depois a mais velha). A
 * página 1 abre a passada; as demais vêm na fase seguinte (`buildPlayerStatsPageRequests`), quando o `paging`
 * da página nova já está no raw. Usa os mesmos cursores do bootstrap:people `--estatisticas-jogadores`.
 *
 * Sem isso a tabela `core.person_season_stat` (artilharia, perfil do jogador) só recebia o que a carga manual
 * trouxe e ficava parada no dia dela: o cursor da página, concluído uma vez, nunca mais vencia.
 */
export async function buildPlayerStatsFirstPages(
  comps: CompetitionInfo[],
  raw: RawSource,
  cursors: CursorStore,
  limits: PlanLimits,
  now: Date,
  limit: number,
): Promise<PlannedRequest[]> {
  if (limit <= 0) return [];
  const seasons = await playerStatsSeasons(comps, raw, limits, now);
  const states = await loadPlayerStatsCursors(seasons, cursors);
  const budget = limit - spentToday(seasons, states, now);
  const due: { item: PlannedRequest; age: number; i: number }[] = [];
  seasons.forEach((s, i) => {
    // pelo dia UTC, não pela hora: a passada aberta no dia D volta no dia D + período, qualquer que seja o horário
    // de cada execução (a de "há 3 dias" exatos cairia segundos antes da conclusão da anterior)
    const staleBefore = new Date(startOfUtcDay(now).getTime() - (s.period - 1) * DAY_MS);
    const item = playerStatsPage(s, 1, staleBefore);
    const age = states.get(cursorId(item.cursors[0]!))?.completedAt?.getTime() ?? -Infinity;
    if (age < staleBefore.getTime()) due.push({ item, age, i });
  });
  return due
    .sort((a, b) => a.age - b.age || a.i - b.i)
    .slice(0, Math.max(0, budget))
    .map((d) => d.item);
}

/**
 * Segunda metade: as páginas 2…N de cada temporada cuja passada está aberta, isto é, cuja página buscada por último
 * é mais velha que a página 1 atual (`staleBefore` = conclusão da página 1). A passada que o limite do dia cortou
 * continua no dia seguinte, sem buscar a página 1 de novo.
 */
export async function buildPlayerStatsPageRequests(
  comps: CompetitionInfo[],
  raw: RawSource,
  cursors: CursorStore,
  limits: PlanLimits,
  now: Date,
  limit: number,
): Promise<PlannedRequest[]> {
  if (limit <= 0) return [];
  const seasons = await playerStatsSeasons(comps, raw, limits, now);
  const states = await loadPlayerStatsCursors(seasons, cursors);
  const budget = limit - spentToday(seasons, states, now);
  const open: { start: number; items: PlannedRequest[] }[] = [];
  for (const s of seasons) {
    const start = states.get(cursorId(playerStatsPage(s, 1).cursors[0]!))?.completedAt;
    if (!start) continue;
    const items: PlannedRequest[] = [];
    for (let page = 2; page <= s.pages; page++) {
      const item = playerStatsPage(s, page, start);
      const at = states.get(cursorId(item.cursors[0]!))?.completedAt;
      if (!at || at < start) items.push(item);
    }
    if (items.length) open.push({ start: start.getTime(), items });
  }
  // a passada aberta há mais tempo termina primeiro
  return open
    .sort((a, b) => a.start - b.start)
    .flatMap((o) => o.items)
    .slice(0, Math.max(0, budget));
}

export type StatusCheck =
  { sport: ApiSport; ok: true; status: ProviderStatus } | { sport: ApiSport; ok: false; error: unknown };

/**
 * /status de cada API antes do sync (não consome cota; reconcilia o Governor com o contador do fornecedor).
 * Uma API que falha (timeout, fora do ar) só fica registrada: o sync segue com o contador local, e o
 * futebol não deixa de rodar por causa de uma API auxiliar.
 */
export async function checkProviderStatus(
  sports: readonly ApiSport[],
  status: (sport: ApiSport) => Promise<ProviderStatus>,
): Promise<StatusCheck[]> {
  const out: StatusCheck[] = [];
  for (const sport of sports) {
    try {
      out.push({ sport, ok: true, status: await status(sport) });
    } catch (error) {
      out.push({ sport, ok: false, error });
    }
  }
  return out;
}

/** Job #19: sync diário incremental (prioridade DAILY). */
export function dailyJob(
  catalog: CatalogSource,
  raw: RawSource,
  cursors: CursorStore,
  plan: PlanRules,
  now: () => Date,
  derbyKeys: () => Promise<Set<string>>,
  opts: DailyOptions = {},
): JobSpec {
  return {
    job: 'sync:daily',
    priority: 'DAILY',
    phases: [
      {
        name: 'agenda e referência',
        build: async () => [
          ...buildScheduleRequests(now(), opts),
          ...(await reopenUnfinishedDay(raw, now(), plan)),
        ],
      },
      {
        name: 'detalhe dos encerrados',
        build: async () => {
          const comps = new Map(
            (await catalog.competitions(opts.maxTier ?? 3)).map((c) => [c.leagueId, c] as const),
          );
          const days = opts.backlogDays ?? 3;
          const lists = Array.from({ length: days }, (_, i) => dateList(utcDate(now(), -(i + 1))));
          const ranked = selectDetailFixtures(await collectFixtures(raw, lists), comps, await derbyKeys(), {
            keyOnly: false,
            // lista gravada no meio do jogo (sync das 00:05 com jogo das 22h UTC): o detalhe traz o resultado
            openStartedBefore: new Date(now().getTime() - SURELY_OVER_MS),
          });
          const { pending } = await splitDone(
            ranked.map((f) => f.id),
            cursors,
          );
          const max = opts.maxDetails ?? (isPaid(plan) ? PAID_MAX_DETAILS : 35);
          return buildDetailRequests(pending.slice(0, max), plan.current);
        },
      },
      {
        name: 'rodízio de entidades',
        build: async () => {
          const teams = await teamTargets(catalog, raw, 1);
          const candidates: PlannedRequest[] = [];
          for (const e of TEAM_ENDPOINTS) {
            for (const t of teams)
              candidates.push(plannedRequest(e.step, 'football', e.endpoint, { team: t.teamId }));
          }
          const people = await peopleOfTeams(raw, new Set(teams.map((t) => t.teamId)));
          for (const e of PERSON_ENDPOINTS) {
            candidates.push(
              ...buildPersonRequests(
                e.step,
                e.endpoint,
                e.kind,
                e.kind === 'player' ? people.players : people.coaches,
              ),
            );
          }
          return buildRotationRequests(
            candidates,
            cursors,
            now(),
            opts.rotation ?? (isPaid(plan) ? PAID_ROTATION_LIMIT : 5),
            undefined,
            (item) => item.endpoint,
          );
        },
      },
      {
        name: 'temporada atual',
        build: async () =>
          buildSeasonListRequests(
            await catalog.competitions(opts.seasonListTier ?? 3),
            cursors,
            plan.current,
            now(),
            opts.seasonLists ?? (isPaid(plan) ? 300 : 0),
            opts.force,
          ),
      },
      {
        name: 'estatísticas de jogadores (página 1)',
        build: async () =>
          buildPlayerStatsFirstPages(
            await catalog.competitions(opts.playerStatsTier ?? 3),
            raw,
            cursors,
            plan.current,
            now(),
            playerStatsLimit(plan, opts),
          ),
      },
      {
        name: 'estatísticas de jogadores (demais páginas)',
        build: async () =>
          buildPlayerStatsPageRequests(
            await catalog.competitions(opts.playerStatsTier ?? 3),
            raw,
            cursors,
            plan.current,
            now(),
            playerStatsLimit(plan, opts),
          ),
      },
    ],
  };
}

function playerStatsLimit(plan: PlanRules, opts: DailyOptions): number {
  return opts.playerStats ?? (isPaid(plan) ? 1000 : 0);
}
