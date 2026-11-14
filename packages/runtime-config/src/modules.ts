/**
 * Módulos de dados por esporte e tier (Ajustes → Dados → Módulos por esporte): o liga/desliga de cada tipo de dado que
 * a api-sports renova (escalação, ao vivo, elenco, desfalques, títulos, palpites, odds, estatísticas…), por tier da
 * competição (1, 2 e 3+). É a camada "o que a pessoa reconhece" em cima dos jobs e dos endpoints.
 *
 * Dois tipos de módulo:
 * - `mirror`: itens do catálogo do espelho (mirror.ts). Ligado/desligado é o período ou `off` da coluna do tier em
 *   `MIRROR_PERIODS_<API>`; o sync:mirror e o alerta de frescor já obedecem, sem outra flag.
 * - `job`: passos do sync diário, do ao vivo e dos agentes de IA que não passam pelo espelho. O estado fica em
 *   `MODULES_<API>` (`modulo=on,off,off`, só o que difere do padrão), lido pelo job no env que o scheduler entrega.
 *   O padrão de cada um é o comportamento do código (as constantes `*_MAX_TIER` abaixo, que os jobs também usam).
 * - `fixed`: a agenda do dia, da qual os outros dependem; sempre ligada.
 *
 * O catálogo do espelho (MIRROR_CATALOG) é a fonte dos módulos `mirror`: um teste confere que cada item dele está em
 * exatamente um módulo. Nada aqui gasta cota: é configuração.
 */
import {
  DEFAULT_MIRROR_CONFIG,
  MIRROR_CATALOG,
  defaultPeriods,
  mirrorItem,
  mirrorItems,
  periodColumns,
  tierColumn,
  type MirrorApiConfig,
  type MirrorConfig,
  type MirrorItemDef,
  type MirrorPeriod,
} from './mirror.js';
import type { ValidationError } from './resolve.js';

/** Colunas de tier dos módulos: 1, 2 e 3+ (tier 3 e acima; tier 0, que não existe hoje, conta como 1). */
export const MODULE_TIERS = [1, 2, 3] as const;
export type ModuleTier = (typeof MODULE_TIERS)[number];

/** Tier de uma competição na coluna dos módulos (`null` = competição desconhecida: a coluna mais alta). */
export function moduleTierOf(tier: number | null | undefined): ModuleTier {
  if (tier == null || !Number.isFinite(tier)) return 3;
  return Math.min(Math.max(Math.trunc(tier), 1), 3) as ModuleTier;
}

// ── Padrões dos passos por tier (os jobs leem daqui; o painel mostra o mesmo) ────────────────────────────────────

/**
 * Sync diário: maior tier com o detalhe dos encerrados (escalação, eventos e estatísticas do jogo). Tiers 1 a 3
 * desde o #1160 (decisão do dono em 12/11/2026).
 */
export const MATCH_DETAIL_MAX_TIER = 3;
/** Sync diário: maior tier com a relista da temporada atual (`fixtures?league&season`). */
export const SEASON_LIST_MAX_TIER = 3;
/** Sync diário: maior tier dos times no rodízio de elencos, técnicos e transferências (o tier 2+ é do espelho). */
export const PEOPLE_ROTATION_MAX_TIER = 1;
/** Sync diário: maior tier das pessoas que recebem `/trophies` e `/sidelined` no rodízio. */
export const PERSON_ROTATION_MAX_TIER = 1;
/** Sync diário: maior tier com os números dos jogadores da temporada (`players?league&season`). Tiers 1 a 3 (#1160). */
export const PLAYER_STATS_MAX_TIER = 3;
/** Agentes de IA (resumo, cenário, vídeos, Onde Assistir): maior tier atendido. */
export const AGENT_MAX_TIER = 2;
/** Espelho das outras 11 APIs: maior tier com temporadas, jogos e times. */
export const SPORT_MIRROR_MAX_TIER = 2;

export type ModuleKind = 'fixed' | 'job' | 'mirror';

export interface ModuleDef {
  /** Identificador no texto da flag e no painel (ex.: `match-detail`). */
  id: string;
  kind: ModuleKind;
  /** Jobs agendados (nomes de SCHEDULED_JOBS) que o módulo aciona. */
  jobs: readonly string[];
  /** Endpoints da api-sports (o custo medido no ledger é por endpoint e job). Vazio nos agentes de IA. */
  endpoints: readonly string[];
  /** Tiers com switch próprio; vazio = um switch só, para a API inteira. */
  tiers: readonly ModuleTier[];
  /** `job`: padrão de cada switch (um por tier, ou um só sem tier). */
  defaults: readonly boolean[];
  /** `mirror`: ids dos itens do catálogo do espelho que o switch liga e desliga. */
  items: readonly string[];
  /** Agente de IA: não gasta cota da api-sports. */
  ai?: boolean;
  /**
   * Passos do job (nomes em `ops.job_run.stats`) que medem o custo do módulo, quando o endpoint não basta: no sync
   * diário a agenda, a relista e o detalhe usam o mesmo `/fixtures`. Sem isto, o custo medido é o do ledger por
   * endpoint e job.
   */
  steps?: readonly string[];
}

const tiersUpTo = (maxTier: number): readonly boolean[] => MODULE_TIERS.map((t) => t <= maxTier);

const fixed = (id: string, jobs: readonly string[], endpoints: readonly string[]): ModuleDef => ({
  id,
  kind: 'fixed',
  jobs,
  endpoints,
  tiers: [],
  defaults: [true],
  items: [],
});

const job = (
  id: string,
  jobs: readonly string[],
  endpoints: readonly string[],
  defaults: readonly boolean[],
  extra: Partial<ModuleDef> = {},
): ModuleDef => ({
  id,
  kind: 'job',
  jobs,
  endpoints,
  tiers: defaults.length === 1 ? [] : [...MODULE_TIERS],
  defaults,
  items: [],
  ...extra,
});

/** Tiers das colunas de um item do espelho: o rótulo de cada coluna (`['2','3']` → tiers 2 e 3+); sem coluna, nenhum. */
function itemTiers(def: MirrorItemDef): ModuleTier[] {
  return def.tiers.map((label) => moduleTierOf(Number(label)));
}

/** Módulo do espelho: as colunas vêm dos itens, que têm que ter as mesmas (o teste confere). */
function mirror(
  api: string,
  id: string,
  items: readonly string[],
  jobs: readonly string[] = ['sync-mirror'],
): ModuleDef {
  const defs = items.map((i) => {
    const def = mirrorItem(api, i);
    if (!def) throw new Error(`Módulos ${api}: ${i} fora do catálogo do espelho`);
    return def;
  });
  const first = defs[0]!;
  for (const d of defs)
    if (d.tiers.join() !== first.tiers.join())
      throw new Error(`Módulos ${api}/${id}: ${d.id} tem colunas de tier diferentes de ${first.id}`);
  const tiers = itemTiers(first);
  return {
    id,
    kind: 'mirror',
    jobs,
    endpoints: [...new Set(defs.map((d) => d.endpoint))],
    tiers,
    // ligado por padrão quando algum item nasce ligado naquela coluna (o tier 3+ de palpites, odds e estatísticas de
    // time, e das outras APIs, nasce desligado: liga no painel)
    defaults: (tiers.length ? tiers : [1]).map((_, col) => defs.some((d) => defaultPeriods(d)[col] != null)),
    items,
  };
}

const FOOTBALL_REFERENCE = MIRROR_CATALOG.football!.filter((i) => i.reference).map((i) => i.id);

/** Módulos do futebol, na ordem do painel. */
const FOOTBALL_MODULES: readonly ModuleDef[] = [
  { ...fixed('agenda', ['sync-daily'], ['/fixtures', '/leagues']), steps: ['fixtures-data', 'leagues'] },
  job('injuries-day', ['sync-daily'], ['/injuries'], [true]),
  job('season-list', ['sync-daily'], ['/fixtures'], tiersUpTo(SEASON_LIST_MAX_TIER), {
    steps: ['temporada-atual'],
  }),
  job('match-detail', ['sync-daily'], ['/fixtures'], tiersUpTo(MATCH_DETAIL_MAX_TIER), {
    steps: ['detalhe'],
  }),
  job('live', ['live-run', 'live-reconcile'], ['/fixtures'], tiersUpTo(3)),
  job(
    'people-rotation',
    ['sync-daily'],
    ['/players/squads', '/coachs', '/transfers'],
    tiersUpTo(PEOPLE_ROTATION_MAX_TIER),
  ),
  mirror('football', 'people-mirror', ['/players/squads', '/coachs', '/transfers']),
  mirror('football', 'injuries-season', ['/injuries']),
  job('sidelined', ['sync-daily'], ['/sidelined'], tiersUpTo(PERSON_ROTATION_MAX_TIER)),
  job('trophies', ['sync-daily'], ['/trophies'], tiersUpTo(PERSON_ROTATION_MAX_TIER)),
  mirror('football', 'predictions', ['/predictions']),
  mirror('football', 'odds', ['/odds']),
  mirror('football', 'team-stats', ['/teams/statistics']),
  mirror('football', 'h2h', ['/fixtures/headtohead']),
  mirror('football', 'top-players', [
    '/players/topscorers',
    '/players/topassists',
    '/players/topyellowcards',
    '/players/topredcards',
  ]),
  mirror('football', 'standings', ['/standings']),
  mirror('football', 'rounds-teams', ['/fixtures/rounds', '/teams']),
  mirror('football', 'venues', ['/venues']),
  job('player-stats', ['sync-daily'], ['/players'], tiersUpTo(PLAYER_STATS_MAX_TIER)),
  mirror('football', 'reference', FOOTBALL_REFERENCE),
  job('wtw', ['wtw-run', 'wtw-channel', 'wtw-rights'], [], tiersUpTo(AGENT_MAX_TIER), { ai: true }),
  job('ai-content', ['recap-run', 'context-run', 'related-run'], [], tiersUpTo(AGENT_MAX_TIER), { ai: true }),
];

/** Lista da temporada de cada uma das outras 11 APIs (a agenda do dia usa o mesmo endpoint com `date=`). */
const SEASON_LIST_IDS = new Set(['/games', '/races', '/fights']);
const isStandings = (id: string) => id === '/standings' || id.startsWith('/rankings/');
const isTeamStats = (id: string) => id === '/teams/statistics' || id === '/statistics';
const isParticipants = (id: string) => id.startsWith('/fighters');

/**
 * Módulos de uma das outras 11 APIs, a partir do catálogo do espelho: agenda (fixa), referência, temporada,
 * classificação, times, estatísticas por jogo, odds, lutadores, elenco e números dos jogadores, estatísticas de time
 * e lesões, na ordem do painel; só os que a API tem.
 */
function sportModules(api: string): ModuleDef[] {
  const items = mirrorItems(api);
  const ids = (pick: (i: MirrorItemDef) => boolean) => items.filter(pick).map((i) => i.id);
  const seasonList = ids((i) => SEASON_LIST_IDS.has(i.id) && !i.reference);
  const groups: [string, string[]][] = [
    ['reference', ids((i) => !!i.reference)],
    ['season', seasonList],
    ['standings', ids((i) => i.group === 'temporada' && isStandings(i.id))],
    ['teams', ids((i) => i.group === 'temporada' && !i.reference && i.id === '/teams')],
    ['game-stats', ids((i) => i.group === 'por-jogo' && i.id !== '/odds' && !isParticipants(i.id))],
    ['odds', ids((i) => i.group === 'por-jogo' && i.id === '/odds')],
    ['participants', ids((i) => i.group === 'por-jogo' && isParticipants(i.id))],
    ['team-stats', ids((i) => i.group === 'por-time' && isTeamStats(i.id))],
    ['roster', ids((i) => i.group === 'por-time' && !isTeamStats(i.id) && i.id !== '/injuries')],
    ['injuries', ids((i) => i.group === 'por-time' && i.id === '/injuries')],
  ];
  return [
    { ...fixed('agenda', ['sync-daily'], seasonList), steps: ['outros-esportes'] },
    ...groups.filter(([, list]) => list.length).map(([id, list]) => mirror(api, id, list)),
  ];
}

/** Módulos de cada API, na ordem do painel. */
export const MODULE_CATALOG: Readonly<Record<string, readonly ModuleDef[]>> = Object.fromEntries(
  Object.keys(MIRROR_CATALOG).map((api) => [api, api === 'football' ? FOOTBALL_MODULES : sportModules(api)]),
);

export const MODULE_APIS = Object.keys(MODULE_CATALOG);

export function moduleDefs(api: string): readonly ModuleDef[] {
  const defs = MODULE_CATALOG[api];
  if (!defs) throw new Error(`Módulos: API desconhecida: ${api}`);
  return defs;
}

export function moduleDef(api: string, id: string): ModuleDef | undefined {
  return MODULE_CATALOG[api]?.find((m) => m.id === id);
}

export function modulesKey(api: string): string {
  return `MODULES_${api.toUpperCase().replace(/-/g, '_')}`;
}

/** Quantos switches o módulo tem (um por tier, ou um só). */
export const moduleColumns = (def: ModuleDef) => Math.max(1, def.tiers.length);

/**
 * Coluna do tier de uma competição num módulo com tiers: a última cujo tier não passa do da competição; 0 nos
 * módulos sem tier; -1 abaixo do primeiro tier do módulo (tier 1 num módulo de tier 2+: o job não o cobre).
 */
export function moduleColumn(def: ModuleDef, tier: number | null | undefined): number {
  if (!def.tiers.length) return 0;
  const t = moduleTierOf(tier);
  let col = -1;
  def.tiers.forEach((mt, i) => {
    if (mt <= t) col = i;
  });
  return col;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

const ON = /^(on|ligado|true|1)$/i;
const OFF = /^(off|desligado|false|0)$/i;

/**
 * `"match-detail=on,on,on; trophies=on,off,off"` → estado por módulo `job` (só os citados). Erros (`format`, com o
 * detalhe): módulo desconhecido ou que não é `job` (os do espelho ficam em MIRROR_PERIODS_<API>), número de valores
 * diferente das colunas, valor fora de on/off, módulo repetido.
 */
export function parseModules(api: string, raw: string | null | undefined): Parsed<Map<string, boolean[]>> {
  const out = new Map<string, boolean[]>();
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, value: out };
  for (const part of text.split(/\s*;\s*|\n+/).filter(Boolean)) {
    const m = /^([a-z][a-z0-9-]*)\s*=\s*(.+)$/i.exec(part.trim());
    if (!m) return { ok: false, error: { code: 'format', detail: part } };
    const id = m[1]!.toLowerCase();
    const def = moduleDef(api, id);
    if (!def || def.kind !== 'job') return { ok: false, error: { code: 'format', detail: id } };
    if (out.has(id)) return { ok: false, error: { code: 'format', detail: `${id} repetido` } };
    const values = m[2]!.split(/\s*,\s*/);
    const n = moduleColumns(def);
    if (values.length !== 1 && values.length !== n)
      return { ok: false, error: { code: 'format', detail: `${id}: ${n} valor(es)` } };
    const states: boolean[] = [];
    for (const v of values) {
      if (ON.test(v)) states.push(true);
      else if (OFF.test(v)) states.push(false);
      else return { ok: false, error: { code: 'format', detail: `${id}=${v}` } };
    }
    out.set(id, values.length === 1 ? Array.from({ length: n }, () => states[0]!) : states);
  }
  return { ok: true, value: out };
}

/** Erro de validação do texto de `MODULES_<API>` (o `check` do registro), ou null. */
export function modulesError(api: string, raw: string): ValidationError | null {
  const r = parseModules(api, raw);
  return r.ok ? null : r.error;
}

const sameStates = (a: readonly boolean[], b: readonly boolean[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Texto canônico de `MODULES_<API>`: só os módulos `job` que diferem do padrão, na ordem do catálogo, com um valor só
 * quando todos os tiers são iguais. Vazio = tudo no padrão.
 */
export function formatModules(api: string, states: ReadonlyMap<string, readonly boolean[]>): string {
  const parts: string[] = [];
  for (const def of moduleDefs(api)) {
    if (def.kind !== 'job') continue;
    const s = states.get(def.id);
    if (!s || sameStates(s, def.defaults)) continue;
    const text = s.map((v) => (v ? 'on' : 'off'));
    parts.push(`${def.id}=${text.every((v) => v === text[0]) ? text[0] : text.join(',')}`);
  }
  return parts.join('; ');
}

/** Estado efetivo dos módulos de uma API. */
export interface ModuleApiConfig {
  api: string;
  /** Estado de cada switch do módulo (um por tier, ou um só). Módulo fixo: `[true]`. */
  states(id: string): boolean[];
  /**
   * O módulo está ligado para uma competição do tier dado? Sem tier num módulo com tiers, vale "algum tier ligado"
   * (competição desconhecida não fica de fora por causa do painel).
   */
  enabled(id: string, tier?: number | null): boolean;
  /** Tiers ligados de um módulo com tiers (vazio = nenhum; nos sem tier, todos quando ligado). */
  tiersOn(id: string): ModuleTier[];
  /** Maior tier ligado (0 = nenhum), o que `catalog.competitions(maxTier)` recebe nos jobs. */
  maxTier(id: string): number;
}

export interface ModuleConfig {
  api(api: string): ModuleApiConfig;
}

/** Estado das colunas de um módulo do espelho a partir dos períodos efetivos dos itens (ligado = algum item ligado). */
function mirrorStates(def: ModuleDef, periods: (id: string) => readonly MirrorPeriod[]): boolean[] {
  const n = moduleColumns(def);
  const out = Array.from({ length: n }, () => false);
  for (const item of def.items) {
    const p = periods(item);
    for (let col = 0; col < n; col++) if (p[col] != null) out[col] = true;
  }
  return out;
}

/**
 * Configuração dos módulos a partir de um leitor de flags (o env do job, já com as sobrescritas do banco que o
 * scheduler aplica, ou as flags resolvidas do painel). Os módulos do espelho vêm de `mirror` (por padrão, o lido
 * das mesmas flags). `strict`: valor inválido é erro (o job não roda com configuração errada); sem `strict`, vale
 * o padrão daquela flag.
 */
export function moduleConfig(
  get: (key: string) => string | null | undefined,
  opts: { strict?: boolean; mirror?: MirrorConfig } = {},
): ModuleConfig {
  const cache = new Map<string, ModuleApiConfig>();
  const apiConfig = (api: string): ModuleApiConfig => {
    const cached = cache.get(api);
    if (cached) return cached;
    const defs = moduleDefs(api);
    const key = modulesKey(api);
    const parsed = parseModules(api, get(key));
    if (!parsed.ok && opts.strict)
      throw new Error(
        `${key} inválido (${parsed.error.code}${parsed.error.detail ? `: ${parsed.error.detail}` : ''})`,
      );
    const overrides = parsed.ok ? parsed.value : new Map<string, boolean[]>();
    let mirrorApi: MirrorApiConfig | null = null;
    const mirrorOf = () => (mirrorApi ??= (opts.mirror ?? DEFAULT_MIRROR_CONFIG).api(api));
    const byId = new Map(defs.map((d) => [d.id, d]));
    const states = (id: string): boolean[] => {
      const def = byId.get(id);
      if (!def) throw new Error(`Módulos ${api}: módulo fora do catálogo: ${id}`);
      if (def.kind === 'mirror') return mirrorStates(def, (item) => mirrorOf().periods(item));
      return [...(overrides.get(id) ?? def.defaults)];
    };
    const enabled = (id: string, tier?: number | null): boolean => {
      const def = byId.get(id);
      const s = states(id);
      if (!def!.tiers.length) return s[0]!;
      if (tier == null) return s.some(Boolean);
      return s[moduleColumn(def!, tier)] ?? false;
    };
    const tiersOn = (id: string): ModuleTier[] => {
      const def = byId.get(id);
      const s = states(id);
      if (!def!.tiers.length) return s[0] ? [...MODULE_TIERS] : [];
      return def!.tiers.filter((_, i) => s[i]);
    };
    const cfg: ModuleApiConfig = {
      api,
      states,
      enabled,
      tiersOn,
      maxTier: (id) => Math.max(0, ...tiersOn(id)),
    };
    cache.set(api, cfg);
    return cfg;
  };
  return { api: apiConfig };
}

/** Configuração do processo do job (env com as sobrescritas do banco); inválida = erro na partida. */
export function moduleConfigFromEnv(
  env: Record<string, string | undefined>,
  mirror?: MirrorConfig,
): ModuleConfig {
  return moduleConfig((key) => env[key], { strict: true, ...(mirror ? { mirror } : {}) });
}

/** Tudo no padrão do código: o comportamento de antes do painel (testes, jobs sem configuração). */
export const DEFAULT_MODULE_CONFIG: ModuleConfig = moduleConfig(() => null);

/**
 * Períodos do espelho com os switches de um módulo `mirror` aplicados: coluna desligada vira `off`, coluna religada
 * volta ao período gravado antes ou, sem ele, ao padrão do catálogo. É o que o painel grava em
 * `MIRROR_PERIODS_<API>` (via `formatMirrorPeriods`) quando mexe num módulo do espelho.
 */
export function applyModuleToMirrorPeriods(
  api: string,
  def: ModuleDef,
  states: readonly boolean[],
  periods: ReadonlyMap<string, readonly MirrorPeriod[]>,
  /** Só estas colunas do módulo mudam (padrão: todas); as outras ficam como estão nos itens. */
  only?: readonly boolean[],
): Map<string, MirrorPeriod[]> {
  const out = new Map<string, MirrorPeriod[]>([...periods].map(([id, p]) => [id, [...p]]));
  for (const item of def.items) {
    const itemDef = mirrorItem(api, item)!;
    const n = periodColumns(itemDef);
    const current = out.get(item) ?? [...itemDef.defaults];
    const next: MirrorPeriod[] = [];
    for (let col = 0; col < n; col++) {
      // módulo com tiers: a coluna do item é a do tier da coluna do módulo; sem tiers, a coluna 0
      const moduleCol = def.tiers.length ? def.tiers.findIndex((t) => tierColumn(itemDef, t) === col) : 0;
      const mc = moduleCol < 0 ? 0 : moduleCol;
      if (only && !only[mc]) {
        next.push(current[col] ?? null);
        continue;
      }
      const on = states[mc] ?? true;
      next.push(on ? (current[col] ?? itemDef.defaults[col] ?? null) : null);
    }
    out.set(item, next);
  }
  return out;
}
