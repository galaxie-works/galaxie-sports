import type { ApiSport, PlanLimits, PlanRules } from '@galaxie/apisports-client';
import { PlanViolationError, ttlFor } from '@galaxie/apisports-client';
import {
  SPORT_MIRROR_MAX_TIER,
  DEFAULT_MIRROR_CONFIG,
  MIRROR_INVENTORY_CURSOR,
  mirrorBudgetCalls,
  mirrorItem,
  tierColumn,
  type MirrorApiConfig,
  type MirrorConfig,
  type MirrorGroupId,
  type MirrorInventory,
} from '@galaxie/runtime-config';
import {
  compareCompetitions,
  covers,
  type CatalogSource,
  type CompetitionInfo,
  type CoverageFlag,
} from './catalog-source.js';
import { collectFixtures, dateList } from './fixtures.js';
import { teamTargets, TEAM_ENDPOINTS } from './people-job.js';
import {
  attemptsOf,
  cursorId,
  MAX_ATTEMPTS,
  type CursorRef,
  type CursorStore,
} from './runtime/cursor-store.js';
import type { RawSource } from './runtime/raw-source.js';
import { plannedRequest, type JobSpec, type PlannedRequest } from './runtime/runner.js';
import { seasonAccessible } from './seasons-job.js';
import { teamsOfSeason } from './teams.js';

/**
 * Espelho da api-sports (sync:mirror): renova, no ritmo de cada endpoint, tudo o que o sync diário não busca.
 *
 * O sync diário cobre a agenda (fixtures/games?date=), o detalhe dos encerrados, a relista da temporada atual do
 * futebol e o rodízio de elencos/técnicos/transferências/títulos/afastamentos dos times tier 1. O resto entrava só
 * nas cargas manuais (bootstrap:seasons, bootstrap:sports, bootstrap:people) e ficava parado: tabela oficial,
 * artilharia, rodadas, times da temporada, lesões da temporada, estatísticas de time, estádios, palpites, odds,
 * referência e, nos outros 11 esportes, tudo além da agenda do dia.
 *
 * Cada item tem um período; o cursor (o mesmo das cargas manuais) diz quando ele foi buscado pela última vez e o
 * rodízio pega os mais velhos que o período, até o orçamento do dia de cada API. Os grupos de cada API vêm em
 * ordem de prioridade: o grupo seguinte só recebe o que sobrou do orçamento.
 *
 * Fica de fora o que já tem dono: fixtures?date= / fixtures?id= / fixtures?league&season (sync diário),
 * players?league&season (números dos jogadores) e o rodízio tier 1 de pessoas (sync diário).
 *
 * Períodos, endpoints ligados, ordem dos grupos e orçamento vêm do painel (Ajustes → Operação → Espelho): o catálogo
 * com os padrões fica em @galaxie/runtime-config (mirror.ts), o mesmo que alimenta o alerta de frescor.
 */

const DAY_MS = 86_400_000;
/** Temporada em jogo: começa em até 14 dias e não terminou há mais de 7 (mesma regra da relista do sync diário). */
const AHEAD_DAYS = 14;
const AFTER_END_DAYS = 7;
/**
 * Jogos encerrados destes últimos dias recebem os endpoints por jogo (o sync diário grava a agenda de D-1). Com o
 * período padrão de 1 dia, um por dia enquanto o jogo está na janela (no máximo 3 buscas): a correção do fornecedor
 * nas horas seguintes e a resposta vazia logo depois do fim entram na seguinte.
 */
export const FINISHED_LOOKBACK_DAYS = 3;
/** Jogos que começam nestas próximas horas recebem palpites e odds. */
export const UPCOMING_HOURS = 48;
/** Ids por chamada nos endpoints que aceitam `ids` (lote). */
export const IDS_PER_CALL = 10;
/** Tier mais alto do catálogo YAML das outras APIs: até ele as temporadas entram no inventário mesmo desligadas. */
const SPORT_INVENTORY_MAX_TIER = 3;

export interface MirrorCandidate {
  item: PlannedRequest;
  /** Período do item (dias); `null` = desligado no painel (fica no inventário, não no rodízio). */
  periodDays: number | null;
  /** Item do catálogo (runtime-config) e coluna de tier: o inventário que o painel usa na estimativa. */
  slot?: { id: string; column: number };
}

/** Grupo de prioridade de uma API: os grupos são atendidos em ordem com o orçamento que sobrar. */
export interface MirrorGroup {
  /** Id do grupo no painel (MIRROR_GROUP_ORDER_*). */
  id?: MirrorGroupId;
  name: string;
  candidates: MirrorCandidate[];
}

/** Candidato de um item do catálogo, com o período do painel para o tier da competição. */
function slotCand(
  cfg: MirrorApiConfig,
  id: string,
  tier: number | undefined,
  step: string,
  endpoint: string,
  params: Record<string, string | number>,
  cursors?: CursorRef[],
): MirrorCandidate {
  const def = mirrorItem(cfg.api, id);
  if (!def) throw new Error(`Espelho ${cfg.api}: ${id} fora do catálogo (runtime-config/mirror.ts)`);
  return {
    item: plannedRequest(step, cfg.api as ApiSport, endpoint, params, cursors ? { cursors } : {}),
    periodDays: cfg.period(id, tier),
    slot: { id, column: tierColumn(def, tier) },
  };
}

function utcDate(d: Date, offsetDays = 0): string {
  return new Date(d.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** Temporada em jogo (a atual, ou a próxima que começa em até 14 dias, até 7 dias depois do fim). */
export function inPlay(
  s: { current: boolean; startDate: string | null; endDate: string | null },
  now: Date,
): boolean {
  if (!s.current && !s.startDate) return false;
  if (s.startDate && s.startDate > utcDate(now, AHEAD_DAYS)) return false;
  if (s.endDate && s.endDate < utcDate(now, -AFTER_END_DAYS)) return false;
  return true;
}

/**
 * Orçamento do espelho por API e por dia: MIRROR_BUDGET_PERCENT da cota nos planos pagos (padrão 20%: Ultra 15.000,
 * Pro 1.500); free 10.
 */
export function mirrorBudget(limits: PlanLimits, percent = DEFAULT_MIRROR_CONFIG.budgetPercent): number {
  return mirrorBudgetCalls(limits.dailyLimit, percent, !!limits.seasons);
}

/** Inventário de uma execução: pedidos por item e coluna de tier, ligados ou não (base da estimativa do painel). */
export function mirrorInventory(groups: readonly MirrorGroup[], at: Date, plan?: string): MirrorInventory {
  const items: Record<string, number[]> = {};
  for (const g of groups)
    for (const c of g.candidates) {
      if (!c.slot) continue;
      const counts = (items[c.slot.id] ??= []);
      while (counts.length <= c.slot.column) counts.push(0);
      counts[c.slot.column]! += 1;
    }
  return { at: at.toISOString(), ...(plan ? { plan } : {}), items };
}

/**
 * Grupos na ordem do painel. Os itens desligados ficam: o rodízio não os escolhe (`periodDays` nulo), mas conta o que
 * eles já gastaram hoje no orçamento (desligar e reexecutar no mesmo dia não libera de novo a cota já gasta).
 */
export function arrangeGroups(
  groups: readonly MirrorGroup[],
  order: readonly MirrorGroupId[],
): MirrorGroup[] {
  const rank = (g: MirrorGroup) => {
    const i = g.id ? order.indexOf(g.id) : -1;
    return i < 0 ? order.length : i;
  };
  return [...groups]
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map(({ g }) => g);
}

/** Tira o que o plano vigente recusaria (temporada fora da janela, parâmetro proibido): não ocupa vaga no rodízio. */
export function allowedByPlan(c: MirrorCandidate, plan: PlanRules, now: Date): boolean {
  try {
    plan.validate(c.item.params, now);
    return true;
  } catch (err) {
    if (err instanceof PlanViolationError) return false;
    throw err;
  }
}

/**
 * Rodízio por grupos: dentro de cada grupo, nunca buscados primeiro (na ordem dada), depois os mais velhos que o
 * período. O que já foi renovado hoje conta no orçamento (reexecutar no mesmo dia não gasta de novo).
 */
export async function rotateGroups(
  groups: MirrorGroup[],
  cursors: CursorStore,
  now: Date,
  limit: number,
  opts: { force?: boolean | undefined } = {},
): Promise<PlannedRequest[]> {
  const all = groups.flatMap((g) => g.candidates);
  const states = await cursors.load(all.flatMap((c) => c.item.cursors));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let left = limit - (opts.force ? 0 : callsSpentToday(all, states, today));
  const out: PlannedRequest[] = [];
  for (const g of groups) {
    const aged: { item: PlannedRequest; age: number; i: number }[] = [];
    g.candidates.forEach((orig, i) => {
      if (orig.periodDays === null) return;
      // falhou MAX_ATTEMPTS vezes sem concluir: o runner não tenta de novo, então não ocupa vaga no orçamento
      const exhausted = (ref: CursorRef) => {
        const st = states.get(cursorId(ref));
        return !st?.completedAt && attemptsOf(st) >= MAX_ATTEMPTS;
      };
      const c = opts.force ? orig : withoutExhausted(orig, exhausted);
      if (!c) return;
      // corte por dia UTC, não por 24 h exatas: o renovado ontem (a qualquer hora) vence hoje no período de 1 dia;
      // com 24 h exatas, a execução das 08:00 achava em dia o item buscado segundos depois das 08:00 de ontem
      const staleBefore = new Date(today - (Math.max(1, c.periodDays ?? 1) - 1) * DAY_MS);
      const age = Math.min(
        ...c.item.cursors.map((ref) => states.get(cursorId(ref))?.completedAt?.getTime() ?? -Infinity),
      );
      // --forcar: o período não vale (renova de novo o que já está em dia), só o orçamento
      if (!opts.force) {
        if (age >= staleBefore.getTime()) return;
      }
      // o raw mais velho que o corte não serve (o /teams de 7 dias tem TTL de 7 dias e saía do cache no dia de
      // vencer); --forcar: sem o cache do raw (maxAgeMs 0), senão a resposta ruim de hoje voltaria do cache
      const maxAgeMs = opts.force
        ? 0
        : Math.min(ttlFor(c.item.endpoint, c.item.params, now), now.getTime() - staleBefore.getTime());
      aged.push({ item: { ...c.item, staleBefore, maxAgeMs }, age, i });
    });
    if (left <= 0) continue;
    const picked = aged.sort((a, b) => a.age - b.age || a.i - b.i).slice(0, left);
    left -= picked.length;
    out.push(...picked.map((a) => a.item));
  }
  return out;
}

/**
 * Tira do pedido os cursores esgotados. Lote de `ids`: sai só o id esgotado, e o jogo novo que caiu no mesmo lote
 * ainda é buscado. Pedido de um cursor só (ou sem `ids`) esgotado: sai inteiro.
 */
function withoutExhausted(
  c: MirrorCandidate,
  exhausted: (ref: CursorRef) => boolean,
): MirrorCandidate | null {
  const dead = c.item.cursors.filter(exhausted);
  if (!dead.length) return c;
  const ids = c.item.params.ids;
  if (typeof ids !== 'string' || dead.length === c.item.cursors.length) return null;
  const keep = c.item.cursors.filter((ref) => !exhausted(ref));
  const keepIds = keep.map((ref) => ref.key.replace(/^id=/, ''));
  if (keepIds.some((id) => !ids.split('-').includes(id))) return null;
  return { ...c, item: { ...c.item, params: { ...c.item.params, ids: keepIds.join('-') }, cursors: keep } };
}

/**
 * Chamadas ao fornecedor já feitas hoje, contadas pelos cursores e não pelos pedidos de agora: os lotes de `ids` são
 * remontados a cada execução (a janela de jogos anda), então um pedido de hoje pode não bater com nenhum de agora.
 * Concluída: uma por `requestHash` (cache não gasta cota). Erro: por endpoint e instante da última tentativa (o runner
 * registra o erro de uma chamada em todos os cursores dela de uma vez), pesando todas as `attempts`: o cursor guarda
 * só a última data, então as anteriores podem ter sido hoje. Na dúvida conta a mais (gasta menos cota, nunca mais).
 */
function callsSpentToday(
  candidates: MirrorCandidate[],
  states: Map<string, { completedAt: Date | null; cursor: Record<string, unknown> | null }>,
  today: number,
): number {
  const calls = new Set<string>();
  const failed = new Map<string, number>();
  for (const c of candidates)
    for (const ref of c.item.cursors) {
      const st = states.get(cursorId(ref));
      if (!st) continue;
      if (st.completedAt && st.completedAt.getTime() >= today) {
        if (st.cursor?.source === 'cache') continue;
        const hash = st.cursor?.requestHash;
        calls.add(typeof hash === 'string' ? `ok|${hash}` : `ok|${cursorId(ref)}`);
      } else if (triedSince(st, today)) {
        const key = `${ref.sport}|${ref.endpoint}|${String(st.cursor?.lastAttemptAt)}`;
        failed.set(key, Math.max(failed.get(key) ?? 0, Math.max(1, attemptsOf(st))));
      }
    }
  let errors = 0;
  for (const n of failed.values()) errors += n;
  return calls.size + errors;
}

/** Tentativa com erro registrada a partir de `since` (ms), sem conclusão depois dela. */
function triedSince(
  st: { completedAt: Date | null; cursor: Record<string, unknown> | null } | undefined,
  since: number,
) {
  const at = st?.cursor?.lastAttemptAt;
  if (typeof at !== 'string') return false;
  const t = Date.parse(at);
  return t >= since && !(st?.completedAt && st.completedAt.getTime() >= t);
}

// ─── futebol ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Por competição × temporada em jogo, com a flag de `coverage`. O período por tier (1, 2 e 3+, este num grupo
 * próprio) vem do catálogo do espelho (runtime-config), editável no painel.
 */
export const FOOTBALL_SEASON_ENDPOINTS: {
  step: string;
  endpoint: string;
  extra?: Record<string, string>;
  flag?: CoverageFlag;
}[] = [
  { step: 'standings', endpoint: '/standings', flag: 'standings' },
  { step: 'injuries', endpoint: '/injuries', flag: 'injuries' },
  { step: 'topscorers', endpoint: '/players/topscorers', flag: 'top_scorers' },
  { step: 'topassists', endpoint: '/players/topassists', flag: 'top_assists' },
  { step: 'topyellowcards', endpoint: '/players/topyellowcards', flag: 'top_cards' },
  { step: 'topredcards', endpoint: '/players/topredcards', flag: 'top_cards' },
  { step: 'rounds', endpoint: '/fixtures/rounds', extra: { dates: 'true' } },
  { step: 'teams', endpoint: '/teams' },
];

/** Referência do futebol sem parâmetros (o /leagues já vem todo dia no sync diário). */
export const FOOTBALL_REFERENCE = [
  '/timezone',
  '/countries',
  '/leagues/seasons',
  '/teams/countries',
  '/players/seasons',
  '/odds/bookmakers',
  '/odds/bets',
  '/odds/live/bets',
] as const;

const UPCOMING = new Set(['TBD', 'NS']);

export interface FootballMirrorOptions {
  /** Maior tier com as chamadas por temporada (padrão 3: todo o catálogo). */
  seasonTier?: number | undefined;
  /** Maior tier com estatísticas de time, palpites e odds (padrão: o do catálogo; o tier 3 nasce desligado no painel). */
  detailTier?: number | undefined;
  /** Maior tier com elencos/técnicos/transferências no rodízio (padrão 3; o tier 1 é do sync diário). */
  teamTier?: number | undefined;
  /** Períodos e endpoints ligados (padrão: o catálogo do runtime-config). */
  mirror?: MirrorApiConfig | undefined;
}

export async function footballGroups(
  catalog: CatalogSource,
  raw: RawSource,
  limits: PlanLimits,
  now: Date,
  derbyPairs: () => Promise<string[]>,
  opts: FootballMirrorOptions = {},
): Promise<MirrorGroup[]> {
  const seasonTier = opts.seasonTier ?? 3;
  const cfg = opts.mirror ?? DEFAULT_MIRROR_CONFIG.api('football');
  // palpites, odds e estatísticas de time: a coluna do tier 3 nasce desligada no catálogo, então os candidatos dele
  // entram com período nulo (fora do rodízio, dentro do inventário: o painel mostra o que ligar custaria); a opção da
  // CLI corta antes
  const detailTier = opts.detailTier ?? seasonTier;
  const cand = (
    id: string,
    tier: number | undefined,
    step: string,
    endpoint: string,
    params: Record<string, string | number>,
  ) => slotCand(cfg, id, tier, step, endpoint, params);
  const comps = [...(await catalog.competitions(seasonTier))].sort(compareCompetitions);
  const playing: { c: CompetitionInfo; s: CompetitionInfo['seasons'][number] }[] = [];
  for (const c of comps)
    for (const s of c.seasons) if (inPlay(s, now) && seasonAccessible(s.year, limits)) playing.push({ c, s });

  const reference: MirrorCandidate[] = FOOTBALL_REFERENCE.map((e) => cand(e, undefined, 'referencia', e, {}));
  // tier 3 (mais de mil competições) num grupo próprio, depois de odds e estatísticas (padrão: o dobro do período)
  const season: MirrorCandidate[] = [];
  const seasonTier3: MirrorCandidate[] = [];
  for (const { c, s } of playing) {
    for (const e of FOOTBALL_SEASON_ENDPOINTS) {
      if (e.flag && !covers(s.coverage, e.flag)) continue;
      (c.tier >= 3 ? seasonTier3 : season).push(
        cand(e.endpoint, c.tier, e.step, e.endpoint, { league: c.leagueId, season: s.year, ...e.extra }),
      );
    }
  }
  const countries = [...new Set(comps.map((c) => c.countryName).filter((n): n is string => !!n))];
  const venues = countries.map((country) => cand('/venues', undefined, 'venues', '/venues', { country }));

  // palpites e odds dos jogos de hoje e amanhã (agenda já gravada pelo sync diário)
  const byLeague = new Map(comps.filter((c) => c.tier <= detailTier).map((c) => [c.leagueId, c] as const));
  const upcoming: MirrorCandidate[] = [];
  const until = now.getTime() + UPCOMING_HOURS * 3_600_000;
  for (const f of await collectFixtures(raw, [dateList(utcDate(now)), dateList(utcDate(now, 1))])) {
    const c = byLeague.get(f.leagueId);
    if (!c || !UPCOMING.has(f.status)) continue;
    const at = Date.parse(f.date);
    if (Number.isNaN(at) || at < now.getTime() || at > until) continue;
    const cov = c.seasons.find((s) => s.year === f.season)?.coverage ?? null;
    // a coluna do tier é o liga/desliga por tier do painel (módulos `predictions` e `odds`)
    if (covers(cov, 'predictions'))
      upcoming.push(cand('/predictions', c.tier, 'predictions', '/predictions', { fixture: f.id }));
    if (covers(cov, 'odds')) upcoming.push(cand('/odds', c.tier, 'odds', '/odds', { fixture: f.id }));
  }

  const teamStats: MirrorCandidate[] = [];
  for (const { c, s } of playing) {
    if (c.tier > detailTier) continue;
    for (const t of await teamsOfSeason(raw, c.leagueId, s.year))
      teamStats.push(
        cand('/teams/statistics', c.tier, 'teams-statistics', '/teams/statistics', {
          league: c.leagueId,
          season: s.year,
          team: t.id,
        }),
      );
  }

  const derbies = (await derbyPairs()).map((h2h) =>
    cand('/fixtures/headtohead', undefined, 'h2h-classicos', '/fixtures/headtohead', { h2h }),
  );

  // tier 2+ (o tier 1 já gira no sync diário): padrão elenco a cada 14 dias, técnicos e transferências a cada 30
  const teams = (await teamTargets(catalog, raw, opts.teamTier ?? 3)).filter((t) => t.tier >= 2);
  const squads: MirrorCandidate[] = [];
  // colunas tier 2 e 3+ (módulo `people-mirror` do painel): o tier do time é o da sua melhor competição
  for (const e of TEAM_ENDPOINTS)
    for (const t of teams) squads.push(cand(e.endpoint, t.tier, e.step, e.endpoint, { team: t.teamId }));

  return [
    {
      id: 'temporada',
      name: 'referência e temporada atual',
      candidates: [...reference, ...season, ...venues],
    },
    { id: 'palpites-odds', name: 'palpites e odds', candidates: upcoming },
    { id: 'estatisticas', name: 'estatísticas de time e clássicos', candidates: [...teamStats, ...derbies] },
    { id: 'tier3', name: 'temporada atual tier 3', candidates: seasonTier3 },
    { id: 'elencos', name: 'elencos tier 2+', candidates: squads },
  ];
}

// ─── outros 11 esportes ──────────────────────────────────────────────────────────────────────────

/** Temporada de uma competição de outro esporte, com a chave do fornecedor (basquete: "2024-2025"). */
export interface SportSeason {
  league: string;
  tier: number;
  year: number;
  key: string;
  current: boolean;
  startDate: string | null;
  endDate: string | null;
  /** `coverage` da temporada no /leagues (o que o fornecedor diz ter); ausente = sem informação, busca tudo. */
  coverage?: unknown;
}

/** Jogo/luta/sessão já no core (id do fornecedor). */
export interface SportGame {
  id: string;
  league: string;
  year: number;
  tier: number;
  status: string;
  startsAt: Date;
  /** F1: tipo da sessão (`Race`, `Sprint`, `1st Practice`…), do item de /races guardado no core. */
  session?: string | null;
}

export interface SportMirrorSource {
  /** Referência (sem parâmetros) e temporadas das competições do catálogo YAML. */
  seasons(sport: OtherSport): Promise<SportSeason[]>;
  /** Jogos do catálogo que começam no intervalo. */
  games(sport: OtherSport, from: Date, to: Date, maxTier: number): Promise<SportGame[]>;
  /** Times (ids do fornecedor) que jogaram ou vão jogar na temporada. */
  teams(sport: OtherSport, league: string, year: number): Promise<string[]>;
  /** Participantes (lutadores, no MMA) de jogos do intervalo. */
  /** Só os de jogos das temporadas `years` (as que o plano alcança: as outras o fornecedor nem lista). */
  participants(sport: OtherSport, from: Date, to: Date, years: readonly number[]): Promise<string[]>;
}

export type OtherSport = Exclude<ApiSport, 'football'>;

interface GameCall {
  endpoint: string;
  /** Item no catálogo do espelho quando o endpoint já aparece em outro item (padrão: o endpoint). */
  id?: string;
  /** Parâmetro do id do jogo; `ids` junta até IDS_PER_CALL jogos numa chamada. */
  param: string;
  batch?: boolean;
  /** Caminho no `coverage` da temporada; `false` lá = o fornecedor não tem, não gasta chamada. */
  coverage?: readonly string[];
  /** Só para alguns jogos (F1: pit stop só existe em corrida). */
  when?: (g: SportGame) => boolean;
}

/** O fornecedor marcou o dado como ausente (`false` no caminho). Caminho ausente ou sem `coverage`: tem. */
export function covered(coverage: unknown, path: readonly string[] | undefined): boolean {
  if (!path) return true;
  let node: unknown = coverage;
  for (const key of path) {
    if (node === false) return false;
    if (node == null || typeof node !== 'object') return true;
    node = (node as Record<string, unknown>)[key];
  }
  if (node === false) return false;
  // objeto com todas as folhas false (ex.: statistics { teams: false, players: false })
  if (node && typeof node === 'object') {
    const leaves = Object.values(node as Record<string, unknown>);
    if (leaves.length && leaves.every((v) => v === false)) return false;
  }
  return true;
}

/**
 * O que a api-sports oferece em cada API além da agenda (docs/research/api-sports-outros-esportes.md).
 * `standings`/`teams`: por temporada; `teamStats`/`roster`: por time e temporada; `finished`: por jogo encerrado;
 * `odds`: por jogo que vai começar.
 */
export interface SportMirrorProfile {
  reference: readonly string[];
  /** Lista da temporada inteira (games/races/fights). */
  seasonList: (league: string, key: string) => { endpoint: string; params: Record<string, string> };
  standings: (league: string, key: string) => { endpoint: string; params: Record<string, string> }[];
  /** teams?league&season (as APIs v1 clássicas). */
  seasonTeams?: boolean;
  teamStats?: (
    league: string,
    key: string,
    team: string,
  ) => { endpoint: string; params: Record<string, string> };
  roster?: (key: string, team: string) => { endpoint: string; params: Record<string, string> }[];
  /** Caminhos no `coverage` que liberam cada grupo (ausente = sempre). */
  covers?: {
    standings?: readonly string[];
    teamStats?: readonly string[];
    roster?: readonly string[];
    odds?: readonly string[];
  };
  finished?: GameCall[];
  odds?: string;
  /** Endpoints por participante (MMA: perfil e cartel do lutador). */
  participants?: { endpoint: string; param: string }[];
  /** Lesões por time (NFL). */
  injuries?: boolean;
}

const ODDS_REF = ['/odds/bets', '/odds/bookmakers'] as const;
const games = (league: string, season: string) => ({ endpoint: '/games', params: { league, season } });
const standings = (league: string, season: string) => [
  { endpoint: '/standings', params: { league, season } },
];
const leagueTeamStats = (endpoint: string) => (league: string, season: string, team: string) => ({
  endpoint,
  params: { league, season, team },
});

const classic = (extra: Partial<SportMirrorProfile> = {}): SportMirrorProfile => ({
  reference: ['/timezone', '/seasons', '/countries', '/leagues', ...ODDS_REF],
  seasonList: games,
  standings,
  seasonTeams: true,
  teamStats: leagueTeamStats('/teams/statistics'),
  odds: '/odds',
  covers: { standings: ['standings'], odds: ['odds'] },
  ...extra,
});

export const SPORT_MIRROR: Record<OtherSport, SportMirrorProfile> = {
  // a tabela do beisebol é calculada aqui pelo aproveitamento (standings/win-pct.ts): a do fornecedor fica de fora
  baseball: classic({ standings: () => [] }),
  handball: classic(),
  rugby: classic(),
  volleyball: classic(),
  hockey: classic({ finished: [{ endpoint: '/games/events', param: 'game' }] }),
  basketball: classic({
    reference: ['/timezone', '/seasons', '/countries', '/leagues', '/bookmakers', '/bets'],
    // no basquete o agregado do time fica em /statistics
    teamStats: leagueTeamStats('/statistics'),
    roster: (season, team) => [{ endpoint: '/players', params: { team, season } }],
    covers: {
      standings: ['standings'],
      teamStats: ['games', 'statistics', 'teams'],
      roster: ['players'],
      odds: ['odds'],
    },
    finished: [
      {
        endpoint: '/games/statistics/teams',
        param: 'ids',
        batch: true,
        coverage: ['games', 'statistics', 'teams'],
      },
      {
        endpoint: '/games/statistics/players',
        param: 'ids',
        batch: true,
        coverage: ['games', 'statistics', 'players'],
      },
    ],
  }),
  afl: {
    reference: ['/timezone', '/seasons', '/leagues', ...ODDS_REF],
    seasonList: games,
    standings,
    seasonTeams: true,
    teamStats: (_league, season, team) => ({ endpoint: '/teams/statistics', params: { id: team, season } }),
    roster: (season, team) => [{ endpoint: '/players', params: { team, season } }],
    finished: [
      { endpoint: '/games/quarters', param: 'id' },
      { endpoint: '/games/events', param: 'id' },
      { endpoint: '/games/statistics/teams', param: 'id' },
      { endpoint: '/games/statistics/players', param: 'id' },
    ],
    odds: '/odds',
  },
  'american-football': {
    reference: ['/timezone', '/seasons', '/leagues', ...ODDS_REF],
    seasonList: games,
    standings,
    seasonTeams: true,
    roster: (season, team) => [
      { endpoint: '/players', params: { team, season } },
      { endpoint: '/players/statistics', params: { team, season } },
    ],
    finished: [
      { endpoint: '/games/events', param: 'id' },
      { endpoint: '/games/statistics/teams', param: 'id' },
      { endpoint: '/games/statistics/players', param: 'id' },
    ],
    odds: '/odds',
    injuries: true,
  },
  nba: {
    reference: ['/seasons', '/leagues', '/teams'],
    seasonList: games,
    standings,
    teamStats: (_league, season, team) => ({ endpoint: '/teams/statistics', params: { id: team, season } }),
    roster: (season, team) => [
      { endpoint: '/players', params: { team, season } },
      { endpoint: '/players/statistics', params: { team, season } },
    ],
    finished: [
      { endpoint: '/games/statistics', param: 'id' },
      { endpoint: '/players/statistics', param: 'game', id: '/players/statistics?game' },
    ],
  },
  'formula-1': {
    reference: ['/timezone', '/seasons', '/competitions', '/circuits', '/teams'],
    seasonList: (_league, season) => ({ endpoint: '/races', params: { season } }),
    standings: (_league, season) => [
      { endpoint: '/rankings/drivers', params: { season } },
      { endpoint: '/rankings/teams', params: { season } },
    ],
    finished: [
      { endpoint: '/rankings/races', param: 'race' },
      { endpoint: '/rankings/fastestlaps', param: 'race' },
      // pit stop só existe em corrida e sprint (treino e classificação dariam resposta vazia)
      { endpoint: '/pitstops', param: 'race', when: (g) => !g.session || /^(race|sprint)$/i.test(g.session) },
    ],
  },
  mma: {
    reference: ['/timezone', '/seasons', '/categories', '/teams', ...ODDS_REF],
    seasonList: (_league, season) => ({ endpoint: '/fights', params: { season } }),
    standings: () => [],
    finished: [
      { endpoint: '/fights/results', param: 'ids', batch: true },
      { endpoint: '/fights/statistics/fighters', param: 'ids', batch: true },
    ],
    odds: '/odds',
    participants: [
      { endpoint: '/fighters', param: 'id' },
      { endpoint: '/fighters/records', param: 'id' },
    ],
  },
};

const FINISHED = 'finished';
const SCHEDULED = new Set(['scheduled', 'starting']);

export interface SportMirrorOptions {
  /** Maior tier do catálogo YAML com temporadas, jogos e times no espelho (padrão: o ligado no painel; 2 de fábrica). */
  maxTier?: number | undefined;
  /** Períodos e endpoints ligados de cada API (padrão: o catálogo do runtime-config). */
  mirror?: MirrorConfig | undefined;
}

export async function sportGroups(
  sport: OtherSport,
  source: SportMirrorSource,
  limits: PlanLimits,
  now: Date,
  opts: SportMirrorOptions = {},
): Promise<MirrorGroup[]> {
  const p = SPORT_MIRROR[sport];
  const cfg = (opts.mirror ?? DEFAULT_MIRROR_CONFIG).api(sport);
  // tiers 1 e 2 como sempre (SPORT_MIRROR_MAX_TIER); o tier 3+ nasce desligado e só entra quando a lista da temporada
  // dele é ligada no painel. Os itens com coluna de tier (temporada, classificação, lesões) ainda geram candidatos do
  // tier 3 com período nulo para o inventário (o painel mostra o que ligar custaria); os de um período só (times, por
  // jogo, por time) ficam fora até a temporada ligar, para a estimativa deles não misturar os tiers
  const seasonEndpoint = p.seasonList('', '').endpoint;
  const maxTier = opts.maxTier ?? Math.max(SPORT_MIRROR_MAX_TIER, cfg.maxTierOn([seasonEndpoint]));
  const tierCovered = (tier: number) => tier <= maxTier;
  const inventoryTier = opts.maxTier ?? Math.max(maxTier, SPORT_INVENTORY_MAX_TIER);
  const cand = (
    id: string,
    tier: number | undefined,
    step: string,
    endpoint: string,
    params: Record<string, string | number>,
    cursors?: CursorRef[],
  ) => slotCand(cfg, id, tier, step, endpoint, params, cursors);
  const reference = p.reference.map((e) => cand(e, undefined, 'referencia', e, {}));
  // F1 e MMA: uma "competição" com a temporada no parâmetro; o mesmo pedido vale uma vez
  const playing = (await source.seasons(sport)).filter(
    (s) => s.tier <= inventoryTier && inPlay(s, now) && seasonAccessible(s.year, limits),
  );
  const season: MirrorCandidate[] = [];
  const perTeam: MirrorCandidate[] = [];
  for (const s of playing) {
    const list = p.seasonList(s.league, s.key);
    season.push(cand(list.endpoint, s.tier, 'temporada', list.endpoint, list.params));
    const cov = (path: readonly string[] | undefined) => covered(s.coverage, path);
    for (const t of cov(p.covers?.standings) ? p.standings(s.league, s.key) : [])
      season.push(cand(t.endpoint, s.tier, 'classificacao', t.endpoint, t.params));
    if (!tierCovered(s.tier)) continue;
    if (p.seasonTeams)
      season.push(cand('/teams', undefined, 'times', '/teams', { league: s.league, season: s.key }));
    if (!p.teamStats && !p.roster && !p.injuries) continue;
    for (const team of await source.teams(sport, s.league, s.year)) {
      if (p.teamStats && cov(p.covers?.teamStats)) {
        const c = p.teamStats(s.league, s.key, team);
        perTeam.push(cand(c.endpoint, undefined, 'estatisticas-time', c.endpoint, c.params));
      }
      for (const r of cov(p.covers?.roster) ? (p.roster?.(s.key, team) ?? []) : [])
        perTeam.push(cand(r.endpoint, undefined, 'elenco', r.endpoint, r.params));
      if (p.injuries) perTeam.push(cand('/injuries', s.tier, 'lesoes', '/injuries', { team }));
    }
  }

  const games: MirrorCandidate[] = [];
  const recent = new Date(now.getTime() - FINISHED_LOOKBACK_DAYS * DAY_MS);
  const ahead = new Date(now.getTime() + UPCOMING_HOURS * 3_600_000);
  const listed = await source.games(sport, recent, ahead, maxTier);
  // jogo de temporada fora da janela do plano (free: 2022–2024): o fornecedor recusaria e cobraria a chamada
  const reachable = listed.filter((g) => seasonAccessible(g.year, limits));
  const finished = reachable.filter((g) => g.status === FINISHED && g.startsAt <= now);
  // coverage da temporada de cada jogo (o /leagues diz o que o fornecedor tem naquela temporada)
  const seasonCoverage = new Map(playing.map((s) => [`${s.league}|${s.year}`, s.coverage]));
  const gameCovers = (g: SportGame, path: readonly string[] | undefined) =>
    covered(seasonCoverage.get(`${g.league}|${g.year}`), path);
  for (const call of p.finished ?? []) {
    const finishedFor = finished.filter((g) => (call.when?.(g) ?? true) && gameCovers(g, call.coverage));
    if (call.batch) {
      for (let i = 0; i < finishedFor.length; i += IDS_PER_CALL) {
        const batch = finishedFor.slice(i, i + IDS_PER_CALL).map((g) => g.id);
        games.push(
          cand(
            call.id ?? call.endpoint,
            undefined,
            'por-jogo',
            call.endpoint,
            { ids: batch.join('-') },
            batch.map((id) => ({ sport, endpoint: call.endpoint, key: `id=${id}` })),
          ),
        );
      }
    } else {
      for (const g of finishedFor)
        games.push(
          cand(call.id ?? call.endpoint, undefined, 'por-jogo', call.endpoint, { [call.param]: g.id }),
        );
    }
  }
  if (p.odds) {
    const param = sport === 'mma' ? 'fight' : 'game';
    for (const g of reachable)
      if (SCHEDULED.has(g.status) && g.startsAt > now && gameCovers(g, p.covers?.odds))
        games.push(cand(p.odds, undefined, 'odds', p.odds, { [param]: g.id }));
  }
  // lutador de temporada fora do plano fica de fora: /fighters não leva `season` e a validação não o barraria
  const years = [...new Set(reachable.map((g) => g.year))];
  for (const pc of p.participants ?? [])
    for (const id of await source.participants(sport, recent, ahead, years))
      games.push(cand(pc.endpoint, undefined, 'participantes', pc.endpoint, { [pc.param]: id }));

  return [
    { id: 'temporada', name: 'referência e temporada atual', candidates: [...reference, ...season] },
    { id: 'por-jogo', name: 'por jogo', candidates: games },
    { id: 'por-time', name: 'por time', candidates: perTeam },
  ];
}

// ─── job ─────────────────────────────────────────────────────────────────────────────────────────

export interface MirrorJobOptions {
  sports: readonly ApiSport[];
  /** Orçamento por API e por dia (padrão: mirrorBudget do plano de cada API). */
  budget?: number | undefined;
  football?: FootballMirrorOptions | undefined;
  other?: SportMirrorOptions | undefined;
  /** --forcar: ignora o período de cada item (o runner também ignora o cache), mantendo o orçamento. */
  force?: boolean | undefined;
  /** Configuração do painel (períodos, endpoints ligados, ordem dos grupos, orçamento); padrão: o do código. */
  mirror?: MirrorConfig | undefined;
}

export interface MirrorDeps {
  catalog: CatalogSource;
  raw: RawSource;
  cursors: CursorStore;
  planFor: (sport: ApiSport) => PlanRules;
  now: () => Date;
  derbyPairs: () => Promise<string[]>;
  sports: SportMirrorSource;
}

/**
 * Job sync:mirror (prioridade DAILY): uma execução por API, cada uma com o orçamento e o plano dela. Separadas
 * porque o runner para a execução inteira na cota esgotada ou num erro do fornecedor que vale para a API toda
 * (429): o futebol sem cota não pode deixar as outras 11 APIs, de cota própria, sem rodar.
 */
export function mirrorJobs(deps: MirrorDeps, opts: MirrorJobOptions): { sport: ApiSport; spec: JobSpec }[] {
  return opts.sports.map((sport) => ({ sport, spec: mirrorJobFor(sport, deps, opts) }));
}

/** Execução com os tiers padrão (a do scheduler): só ela grava o inventário que o painel usa. */
const defaultScope = (opts: MirrorJobOptions) =>
  opts.football?.seasonTier === undefined &&
  opts.football?.detailTier === undefined &&
  opts.football?.teamTier === undefined &&
  opts.other?.maxTier === undefined;

function mirrorJobFor(sport: ApiSport, deps: MirrorDeps, opts: MirrorJobOptions): JobSpec {
  return {
    job: 'sync:mirror',
    priority: 'DAILY',
    phases: [
      {
        name: `espelho ${sport}`,
        build: async () => {
          const now = deps.now();
          const plan = deps.planFor(sport);
          const mirror = opts.mirror ?? DEFAULT_MIRROR_CONFIG;
          const cfg = mirror.api(sport);
          const groups =
            sport === 'football'
              ? await footballGroups(deps.catalog, deps.raw, plan.current, now, deps.derbyPairs, {
                  ...opts.football,
                  mirror: cfg,
                })
              : await sportGroups(sport, deps.sports, plan.current, now, { ...opts.other, mirror });
          const allowed = groups.map((g) => ({
            ...g,
            candidates: g.candidates.filter((c) => allowedByPlan(c, plan, now)),
          }));
          // o inventário conta também os desligados: o painel estima o custo de religar. Só com os tiers padrão
          // (o agendado): um --tier-outros 3 manual não pode inflar a estimativa da tela
          if (defaultScope(opts))
            await deps.cursors.complete(
              [{ sport, ...MIRROR_INVENTORY_CURSOR }],
              { ...mirrorInventory(allowed, now, plan.current.name) },
              now,
            );
          const budget = opts.budget ?? mirrorBudget(plan.current, mirror.budgetPercent);
          return rotateGroups(arrangeGroups(allowed, cfg.groupOrder), deps.cursors, now, budget, {
            force: opts.force,
          });
        },
      },
    ],
  };
}
