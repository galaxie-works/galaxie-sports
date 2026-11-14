/**
 * Espelho da api-sports (sync:mirror) configurável pelo painel: o catálogo do que o job renova, com o período padrão
 * de cada endpoint por tier, os grupos de prioridade e o orçamento. É a fonte única dos períodos: o job
 * (services/ingestor/src/jobs/mirror-job.ts) e o mapa de frescor do alerta RawEndpointOverdue
 * (packages/observability/src/metrics/raw-cadence.ts) leem daqui, com as sobrescritas do painel por cima.
 *
 * Flags (Ajustes → Operação → Espelho), todas com precedência banco > env > padrão do código:
 * - `MIRROR_PERIODS_<API>`: só o que difere do padrão, `endpoint=t1,t2,t3` separados por `;` (um valor só vale para
 *   todos os tiers; `off` desliga o endpoint ou só aquele tier). Vazio = todos os padrões.
 * - `MIRROR_BUDGET_PERCENT`: parte da cota diária de cada API paga que o espelho pode gastar (o free fica em 10).
 * - `MIRROR_GROUP_ORDER_FOOTBALL` e `MIRROR_GROUP_ORDER_SPORTS`: ordem dos grupos; o seguinte só recebe o que sobrou.
 *
 * Nenhum período é 0: o job roda uma vez por dia e o corte é por dia UTC, então o mínimo é 1 dia; para parar de
 * buscar, `off`.
 */
import type { ValidationError } from './resolve.js';

/** Grupos de prioridade do futebol, na ordem padrão. */
export const FOOTBALL_MIRROR_GROUPS = [
  'temporada',
  'palpites-odds',
  'estatisticas',
  'tier3',
  'elencos',
] as const;
/** Grupos de prioridade das outras 11 APIs, na ordem padrão. */
export const SPORT_MIRROR_GROUPS = ['temporada', 'por-jogo', 'por-time'] as const;
export type MirrorGroupId = (typeof FOOTBALL_MIRROR_GROUPS)[number] | (typeof SPORT_MIRROR_GROUPS)[number];

/** Período mínimo e máximo (dias) de um endpoint do espelho. */
export const MIRROR_PERIOD_MIN_DAYS = 1;
export const MIRROR_PERIOD_MAX_DAYS = 365;
/** Orçamento do espelho (% da cota diária de cada API paga): padrão e teto. */
export const MIRROR_BUDGET_DEFAULT_PERCENT = 20;
/**
 * Teto do orçamento: na produção 25% da cota ficam para o ao vivo (QUOTA_LIVE_RESERVE_PERCENT); com 50% no espelho
 * sobra ao menos um quarto para o sync diário e as cargas.
 */
export const MIRROR_BUDGET_MAX_PERCENT = 50;
/** Orçamento fixo do plano free (chamadas por dia): 10% da cota de 100. */
export const MIRROR_FREE_BUDGET = 10;

export const MIRROR_BUDGET_KEY = 'MIRROR_BUDGET_PERCENT';
export const MIRROR_GROUP_ORDER_FOOTBALL_KEY = 'MIRROR_GROUP_ORDER_FOOTBALL';
export const MIRROR_GROUP_ORDER_SPORTS_KEY = 'MIRROR_GROUP_ORDER_SPORTS';

export interface MirrorItemDef {
  /** Identificador no texto da flag: o endpoint (ou o endpoint com o parâmetro, quando ele aparece duas vezes). */
  id: string;
  endpoint: string;
  /** Grupo de prioridade (o tier 3 do futebol vai para o grupo `tier3`, ver `tierGroups`). */
  group: MirrorGroupId;
  /** Rótulos das colunas de tier com período próprio; vazio = um período só para todos. */
  tiers: readonly string[];
  /** Período padrão (dias) de cada coluna (uma só quando `tiers` é vazio); numa coluna `defaultOff`, o período ao ligar. */
  defaults: readonly number[];
  /**
   * Colunas que nascem desligadas (ex.: palpites, odds e estatísticas de time no tier 3; as outras APIs acima do tier
   * 2): o job não as busca até alguém ligar no painel. Um valor só em `MIRROR_PERIODS_<API>` não as liga.
   */
  defaultOff?: readonly boolean[];
  /** Grupo de cada coluna de tier, quando difere de `group`. */
  tierGroups?: readonly MirrorGroupId[];
  /**
   * Referência sem parâmetros: buscada em qualquer plano (até no free) e o ano inteiro, por isso entra no mapa de
   * frescor de todas as APIs (os itens de temporada somem na entressafra e dariam alerta falso).
   */
  reference?: boolean;
}

const item = (
  id: string,
  group: MirrorGroupId,
  defaults: readonly number[],
  tiers: readonly string[] = [],
  extra: Partial<MirrorItemDef> = {},
): MirrorItemDef => ({ id, endpoint: id, group, tiers, defaults, ...extra });

/** Tier 1, 2 e 3+ (o 3 num grupo próprio, com o dobro do período dos demais). */
const SEASON_TIERS = ['1', '2', '3'] as const;
/** Tier 1, 2 e 3+ com o 3+ nascendo desligado (liga no painel; custo só então). */
const OFF_TIER3 = [false, false, true] as const;
/** Tier 2 e 3+ (o tier 1 gira no sync diário). */
const UPPER_TIERS = ['2', '3'] as const;

const footballSeason = (id: string, tier1: number, others: number) =>
  item(id, 'temporada', [tier1, others, others * 2], SEASON_TIERS, {
    tierGroups: ['temporada', 'temporada', 'tier3'],
  });

const FOOTBALL_ITEMS: readonly MirrorItemDef[] = [
  // referência sem parâmetros (o /leagues vem todo dia no sync diário)
  ...[
    '/timezone',
    '/countries',
    '/leagues/seasons',
    '/teams/countries',
    '/players/seasons',
    '/odds/bookmakers',
    '/odds/bets',
    '/odds/live/bets',
  ].map((e) => item(e, 'temporada', [7], [], { reference: true })),
  // por competição × temporada em jogo
  footballSeason('/standings', 1, 2),
  footballSeason('/injuries', 1, 3),
  footballSeason('/players/topscorers', 1, 3),
  footballSeason('/players/topassists', 1, 3),
  footballSeason('/players/topyellowcards', 3, 7),
  footballSeason('/players/topredcards', 3, 7),
  footballSeason('/fixtures/rounds', 7, 7),
  footballSeason('/teams', 7, 14),
  item('/venues', 'temporada', [30]),
  // jogos das próximas 48 h: a coluna do tier é o liga/desliga por tier dos módulos; o tier 3 nasce desligado
  item('/predictions', 'palpites-odds', [1, 1, 1], SEASON_TIERS, { defaultOff: OFF_TIER3 }),
  item('/odds', 'palpites-odds', [1, 1, 1], SEASON_TIERS, { defaultOff: OFF_TIER3 }),
  // por time da temporada em jogo (tier 3 nasce desligado) e clássicos
  item('/teams/statistics', 'estatisticas', [7, 14, 28], SEASON_TIERS, { defaultOff: OFF_TIER3 }),
  item('/fixtures/headtohead', 'estatisticas', [30]),
  // tier 2+ (o tier 1 gira no sync diário); as duas colunas têm o mesmo período, só o liga/desliga difere
  item('/players/squads', 'elencos', [14, 14], UPPER_TIERS),
  item('/coachs', 'elencos', [30, 30], UPPER_TIERS),
  item('/transfers', 'elencos', [30, 30], UPPER_TIERS),
];

interface SportSpec {
  reference: readonly string[];
  /** Lista da temporada inteira (games/races/fights). */
  season: string;
  standings?: readonly string[];
  /** teams?league&season. */
  teams?: boolean;
  teamStats?: string;
  roster?: readonly string[];
  injuries?: boolean;
  /** Por jogo encerrado: endpoint, ou `{ id, endpoint }` quando o endpoint já aparece em outro item. */
  finished?: readonly (string | { id: string; endpoint: string })[];
  odds?: string;
  participants?: readonly string[];
}

/** Itens de uma das outras 11 APIs (o mesmo que SPORT_MIRROR monta no ingestor; o teste de lá confere). */
function sportItems(s: SportSpec): MirrorItemDef[] {
  return [
    ...s.reference.map((e) => item(e, 'temporada', [e === '/leagues' ? 1 : 7], [], { reference: true })),
    // o tier 3+ nasce desligado: ligado, as temporadas dele entram no espelho (jogos, times, odds e o resto junto)
    item(s.season, 'temporada', [2, 7, 14], SEASON_TIERS, { defaultOff: OFF_TIER3 }),
    ...(s.standings ?? []).map((e) =>
      item(e, 'temporada', [1, 2, 4], SEASON_TIERS, { defaultOff: OFF_TIER3 }),
    ),
    ...(s.teams ? [item('/teams', 'temporada', [7])] : []),
    ...(s.finished ?? []).map((f) =>
      typeof f === 'string'
        ? item(f, 'por-jogo', [1])
        : { ...item(f.id, 'por-jogo', [1]), endpoint: f.endpoint },
    ),
    ...(s.odds ? [item(s.odds, 'por-jogo', [1])] : []),
    ...(s.participants ?? []).map((e) => item(e, 'por-jogo', [30])),
    ...(s.teamStats ? [item(s.teamStats, 'por-time', [14])] : []),
    ...(s.roster ?? []).map((e) => item(e, 'por-time', [14])),
    ...(s.injuries
      ? [item('/injuries', 'por-time', [1, 3, 6], SEASON_TIERS, { defaultOff: OFF_TIER3 })]
      : []),
  ];
}

const ODDS_REF = ['/odds/bets', '/odds/bookmakers'] as const;
const CLASSIC_REFERENCE = ['/timezone', '/seasons', '/countries', '/leagues', ...ODDS_REF];
const classic = (extra: Partial<SportSpec> = {}): MirrorItemDef[] =>
  sportItems({
    reference: CLASSIC_REFERENCE,
    season: '/games',
    standings: ['/standings'],
    teams: true,
    teamStats: '/teams/statistics',
    odds: '/odds',
    ...extra,
  });

/** O que o espelho renova em cada API, na ordem em que o painel mostra. */
export const MIRROR_CATALOG: Readonly<Record<string, readonly MirrorItemDef[]>> = {
  football: FOOTBALL_ITEMS,
  afl: sportItems({
    reference: ['/timezone', '/seasons', '/leagues', ...ODDS_REF],
    season: '/games',
    standings: ['/standings'],
    teams: true,
    teamStats: '/teams/statistics',
    roster: ['/players'],
    finished: ['/games/quarters', '/games/events', '/games/statistics/teams', '/games/statistics/players'],
    odds: '/odds',
  }),
  // a tabela do beisebol é calculada aqui pelo aproveitamento: a do fornecedor fica de fora
  baseball: classic({ standings: [] }),
  basketball: sportItems({
    reference: ['/timezone', '/seasons', '/countries', '/leagues', '/bookmakers', '/bets'],
    season: '/games',
    standings: ['/standings'],
    teams: true,
    teamStats: '/statistics',
    roster: ['/players'],
    finished: ['/games/statistics/teams', '/games/statistics/players'],
    odds: '/odds',
  }),
  'formula-1': sportItems({
    reference: ['/timezone', '/seasons', '/competitions', '/circuits', '/teams'],
    season: '/races',
    standings: ['/rankings/drivers', '/rankings/teams'],
    finished: ['/rankings/races', '/rankings/fastestlaps', '/pitstops'],
  }),
  handball: classic(),
  hockey: classic({ finished: ['/games/events'] }),
  mma: sportItems({
    reference: ['/timezone', '/seasons', '/categories', '/teams', ...ODDS_REF],
    season: '/fights',
    finished: ['/fights/results', '/fights/statistics/fighters'],
    odds: '/odds',
    participants: ['/fighters', '/fighters/records'],
  }),
  nba: sportItems({
    reference: ['/seasons', '/leagues', '/teams'],
    season: '/games',
    standings: ['/standings'],
    teamStats: '/teams/statistics',
    roster: ['/players', '/players/statistics'],
    finished: ['/games/statistics', { id: '/players/statistics?game', endpoint: '/players/statistics' }],
  }),
  'american-football': sportItems({
    reference: ['/timezone', '/seasons', '/leagues', ...ODDS_REF],
    season: '/games',
    standings: ['/standings'],
    teams: true,
    roster: ['/players', '/players/statistics'],
    finished: ['/games/events', '/games/statistics/teams', '/games/statistics/players'],
    odds: '/odds',
    injuries: true,
  }),
  rugby: classic(),
  volleyball: classic(),
};

export const MIRROR_APIS = Object.keys(MIRROR_CATALOG);

export function mirrorItems(api: string): readonly MirrorItemDef[] {
  const items = MIRROR_CATALOG[api];
  if (!items) throw new Error(`Espelho: API desconhecida: ${api}`);
  return items;
}

export function mirrorItem(api: string, id: string): MirrorItemDef | undefined {
  return MIRROR_CATALOG[api]?.find((i) => i.id === id);
}

export function mirrorPeriodsKey(api: string): string {
  return `MIRROR_PERIODS_${api.toUpperCase().replace(/-/g, '_')}`;
}

export function mirrorGroupOrderKey(api: string): string {
  return api === 'football' ? MIRROR_GROUP_ORDER_FOOTBALL_KEY : MIRROR_GROUP_ORDER_SPORTS_KEY;
}

export function mirrorGroups(api: string): readonly MirrorGroupId[] {
  return api === 'football' ? FOOTBALL_MIRROR_GROUPS : SPORT_MIRROR_GROUPS;
}

/** Período de uma coluna: dias, ou `null` = desligado. */
export type MirrorPeriod = number | null;

/** Colunas de período de um item (uma quando ele não tem tier). */
export const periodColumns = (def: MirrorItemDef) => Math.max(1, def.tiers.length);

/** Períodos padrão efetivos: o período de cada coluna, `null` nas que nascem desligadas. */
export const defaultPeriods = (def: MirrorItemDef): MirrorPeriod[] =>
  def.defaults.map((d, i) => (def.defaultOff?.[i] ? null : d));

/**
 * Coluna do tier de uma competição: a última coluna cujo rótulo (o menor tier dela) não passa do tier; abaixo do
 * primeiro rótulo (tier 0 num item de tier 1+, tier 1 num item de tier 2+) vale a primeira coluna, acima do último
 * a última. Sem tier (ou item de uma coluna só), a primeira.
 */
export function tierColumn(def: MirrorItemDef, tier: number | undefined): number {
  const n = periodColumns(def);
  if (n === 1 || tier === undefined) return 0;
  const t = Math.trunc(tier);
  let col = 0;
  def.tiers.forEach((label, i) => {
    if (Number(label) <= t) col = i;
  });
  return col;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

const OFF = /^(off|desligado)$/i;

/**
 * `"/standings=1,2,4; /injuries=off"` → sobrescritas por item (só os citados). Erros: endpoint desconhecido
 * (`mirrorItem`), número de tiers diferente das colunas do item (`format`), 0 (`periodZero`) e fora da faixa
 * (`range`).
 */
export function parseMirrorPeriods(
  api: string,
  raw: string | null | undefined,
): Parsed<Map<string, MirrorPeriod[]>> {
  const out = new Map<string, MirrorPeriod[]>();
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, value: out };
  const unknown: string[] = [];
  for (const part of text.split(/\s*;\s*|\n+/).filter(Boolean)) {
    const m = /^(\/[A-Za-z0-9/_?.-]*)\s*=\s*(.+)$/.exec(part.trim());
    if (!m) return { ok: false, error: { code: 'format', detail: part } };
    const id = m[1]!;
    const def = mirrorItem(api, id);
    if (!def) {
      unknown.push(id);
      continue;
    }
    if (out.has(id)) return { ok: false, error: { code: 'format', detail: `${id} repetido` } };
    const values = m[2]!.split(/\s*,\s*/);
    const n = periodColumns(def);
    if (values.length !== 1 && values.length !== n)
      return { ok: false, error: { code: 'format', detail: `${id}: ${n} período(s)` } };
    const periods: MirrorPeriod[] = [];
    for (const v of values) {
      if (OFF.test(v)) {
        periods.push(null);
        continue;
      }
      if (!/^\d+$/.test(v)) return { ok: false, error: { code: 'format', detail: `${id}=${v}` } };
      const days = Number(v);
      if (days === 0) return { ok: false, error: { code: 'periodZero', detail: id } };
      if (days < MIRROR_PERIOD_MIN_DAYS || days > MIRROR_PERIOD_MAX_DAYS)
        return {
          ok: false,
          error: { code: 'range', min: MIRROR_PERIOD_MIN_DAYS, max: MIRROR_PERIOD_MAX_DAYS, detail: id },
        };
      periods.push(days);
    }
    // um valor só vale para as colunas que nascem ligadas; a que nasce desligada só liga por coluna
    out.set(
      id,
      values.length === 1
        ? Array.from({ length: n }, (_, i) => (def.defaultOff?.[i] ? null : periods[0]!))
        : periods,
    );
  }
  if (unknown.length) return { ok: false, error: { code: 'mirrorItem', values: unknown } };
  return { ok: true, value: out };
}

/** Erro de validação do texto de `MIRROR_PERIODS_<API>` (o `check` do registro), ou null. */
export function mirrorPeriodsError(api: string, raw: string): ValidationError | null {
  const r = parseMirrorPeriods(api, raw);
  return r.ok ? null : r.error;
}

const samePeriods = (a: readonly MirrorPeriod[], b: readonly MirrorPeriod[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Texto canônico das sobrescritas: só os itens que diferem do padrão, na ordem do catálogo, com um valor só quando
 * todos os tiers são iguais. Vazio = tudo no padrão.
 */
export function formatMirrorPeriods(
  api: string,
  periods: ReadonlyMap<string, readonly MirrorPeriod[]>,
): string {
  const parts: string[] = [];
  for (const def of mirrorItems(api)) {
    const p = periods.get(def.id);
    if (!p || samePeriods(p, defaultPeriods(def))) continue;
    const text = p.map((v) => (v === null ? 'off' : String(v)));
    // um valor só vale para as colunas que nascem ligadas e deixa desligada a que nasce desligada: o texto só
    // colapsa quando é exatamente isso que ele descreve (com ela ligada, sai coluna a coluna)
    const live = text.filter((_, i) => !def.defaultOff?.[i]);
    const collapsible =
      live.length > 0 &&
      live.every((v) => v === live[0]) &&
      !(def.defaultOff ?? []).some((off, i) => off && p[i] !== null);
    parts.push(`${def.id}=${collapsible ? live[0] : text.join(',')}`);
  }
  return parts.join('; ');
}

/** `"temporada,por-jogo,por-time"` → a ordem; tem que listar cada grupo da API uma vez (`groupOrder`). */
export function parseMirrorGroupOrder(api: string, raw: string | null | undefined): Parsed<MirrorGroupId[]> {
  const groups = mirrorGroups(api);
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, value: [...groups] };
  const list = text.split(/[\s,;>]+/).filter(Boolean);
  const valid =
    list.length === groups.length &&
    new Set(list).size === list.length &&
    list.every((g) => (groups as readonly string[]).includes(g));
  return valid
    ? { ok: true, value: list as MirrorGroupId[] }
    : { ok: false, error: { code: 'groupOrder', values: groups } };
}

export function mirrorGroupOrderError(api: string, raw: string): ValidationError | null {
  const r = parseMirrorGroupOrder(api, raw);
  return r.ok ? null : r.error;
}

/** Configuração efetiva de uma API do espelho. */
export interface MirrorApiConfig {
  api: string;
  /** Períodos de cada coluna do item (padrão com a sobrescrita por cima). */
  periods(id: string): MirrorPeriod[];
  /** Período do item para uma competição do tier dado; `null` = desligado. */
  period(id: string, tier?: number): MirrorPeriod;
  /** Ordem dos grupos de prioridade. */
  groupOrder: readonly MirrorGroupId[];
  /**
   * Maior tier com alguma coluna ligada nos itens dados (padrão: todos os itens com coluna de tier); 0 = nenhuma. É o
   * teto de tier do job: palpites, odds e estatísticas de time do futebol e as temporadas das outras 11 APIs.
   */
  maxTierOn(ids?: readonly string[]): number;
}

export interface MirrorConfig {
  budgetPercent: number;
  api(api: string): MirrorApiConfig;
}

/** Orçamento do espelho de uma API por dia: % da cota nos pagos; o free fica em 10. */
export function mirrorBudgetCalls(dailyLimit: number, percent: number, free: boolean): number {
  return free ? MIRROR_FREE_BUDGET : Math.floor((dailyLimit * percent) / 100);
}

/**
 * Configuração do espelho a partir de um leitor de flags (o env do job, já com as sobrescritas do banco que o
 * scheduler aplica, ou as flags resolvidas do painel e das métricas). `strict`: valor inválido é erro (o job não
 * roda com configuração errada); sem `strict`, vale o padrão daquela flag.
 */
export function mirrorConfig(
  get: (key: string) => string | null | undefined,
  opts: { strict?: boolean } = {},
): MirrorConfig {
  const fail = (key: string, error: ValidationError) => {
    if (opts.strict)
      throw new Error(
        `${key} inválido (${error.code}${error.detail ? `: ${error.detail}` : ''}${error.values ? `: ${error.values.join(', ')}` : ''})`,
      );
  };
  const budgetRaw = (get(MIRROR_BUDGET_KEY) ?? '').trim();
  let budgetPercent = MIRROR_BUDGET_DEFAULT_PERCENT;
  if (budgetRaw) {
    const n = Number(budgetRaw);
    if (Number.isInteger(n) && n >= 1 && n <= MIRROR_BUDGET_MAX_PERCENT) budgetPercent = n;
    else fail(MIRROR_BUDGET_KEY, { code: 'range', min: 1, max: MIRROR_BUDGET_MAX_PERCENT });
  }
  const cache = new Map<string, MirrorApiConfig>();
  const apiConfig = (api: string): MirrorApiConfig => {
    const cached = cache.get(api);
    if (cached) return cached;
    const items = mirrorItems(api);
    const periodsKey = mirrorPeriodsKey(api);
    const parsed = parseMirrorPeriods(api, get(periodsKey));
    if (!parsed.ok) fail(periodsKey, parsed.error);
    const overrides = parsed.ok ? parsed.value : new Map<string, MirrorPeriod[]>();
    const orderKey = mirrorGroupOrderKey(api);
    const order = parseMirrorGroupOrder(api, get(orderKey));
    if (!order.ok) fail(orderKey, order.error);
    const byId = new Map(items.map((d) => [d.id, d]));
    const periods = (id: string): MirrorPeriod[] => {
      const def = byId.get(id);
      if (!def) throw new Error(`Espelho ${api}: item fora do catálogo: ${id}`);
      return [...(overrides.get(id) ?? defaultPeriods(def))];
    };
    const maxTierOn = (ids?: readonly string[]): number => {
      let max = 0;
      for (const def of items) {
        if (!def.tiers.length || (ids && !ids.includes(def.id))) continue;
        const p = periods(def.id);
        def.tiers.forEach((label, i) => {
          if (p[i] != null) max = Math.max(max, Number(label));
        });
      }
      return max;
    };
    const cfg: MirrorApiConfig = {
      api,
      periods,
      period: (id, tier) => periods(id)[tierColumn(byId.get(id)!, tier)] ?? null,
      groupOrder: order.ok ? order.value : [...mirrorGroups(api)],
      maxTierOn,
    };
    cache.set(api, cfg);
    return cfg;
  };
  return { budgetPercent, api: apiConfig };
}

/** Configuração do processo do job (env com as sobrescritas do banco); inválida = erro na partida. */
export function mirrorConfigFromEnv(env: Record<string, string | undefined>): MirrorConfig {
  return mirrorConfig((key) => env[key], { strict: true });
}

/** Tudo no padrão do código (testes, métricas sem banco). */
export const DEFAULT_MIRROR_CONFIG: MirrorConfig = mirrorConfig(() => null);

/**
 * Inventário de uma execução do espelho (gravado pelo job em ops.sync_cursor): quantos pedidos cada item teria em
 * cada coluna de tier com tudo ligado, já sem o que o plano recusa. É a base da estimativa de chamadas no painel.
 */
export interface MirrorInventory {
  /** Instante da execução (ISO). */
  at: string;
  /**
   * Plano da API na execução: a contagem já vem sem o que o plano recusa, então com outro plano ela não vale (o painel
   * descarta). Ausente nos inventários antigos.
   */
  plan?: string;
  /** Pedidos por item e coluna de tier. */
  items: Record<string, number[]>;
}

/** Onde o job grava o inventário de cada API (ops.sync_cursor: sport = API, endpoint e key fixos). */
export const MIRROR_INVENTORY_CURSOR = { endpoint: 'mirror:inventory', key: 'items' } as const;

export interface MirrorEstimate {
  id: string;
  /** Pedidos do item no último inventário (soma das colunas). */
  requests: number;
  /** Chamadas por dia no regime: pedidos ÷ período de cada coluna ligada. */
  callsPerDay: number;
}

/** Estimativa de chamadas por dia de cada item com os períodos dados (`periods` do painel ou da configuração). */
export function estimateMirrorCalls(
  api: string,
  periods: (id: string) => readonly MirrorPeriod[],
  inventory: MirrorInventory | null,
): { items: MirrorEstimate[]; total: number } {
  const items = mirrorItems(api).map((def) => {
    const counts = inventory?.items[def.id] ?? [];
    const p = periods(def.id);
    let callsPerDay = 0;
    let requests = 0;
    counts.forEach((n, i) => {
      requests += n;
      const days = p[i];
      if (days) callsPerDay += n / days;
    });
    return { id: def.id, requests, callsPerDay };
  });
  return { items, total: items.reduce((s, i) => s + i.callsPerDay, 0) };
}

/** Lê o inventário gravado no cursor (formato inválido = sem inventário). */
export function parseMirrorInventory(cursor: unknown): MirrorInventory | null {
  if (!cursor || typeof cursor !== 'object') return null;
  const c = cursor as { at?: unknown; items?: unknown };
  if (typeof c.at !== 'string' || !c.items || typeof c.items !== 'object') return null;
  const items: Record<string, number[]> = {};
  for (const [id, v] of Object.entries(c.items as Record<string, unknown>))
    if (Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0))
      items[id] = v as number[];
  const plan = (cursor as { plan?: unknown }).plan;
  return { at: c.at, ...(typeof plan === 'string' && plan ? { plan } : {}), items };
}
