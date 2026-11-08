/**
 * Regras do Builder (puro: servidor, navegador e testes): o que um widget salvo pode conter, os domínios
 * de uma chave publicável e os textos de instalação (comando do shadcn, uso no código e a variável da
 * chave). Tudo o que chega do navegador passa por `parseWidgetInput` e `parseOrigins` no servidor.
 *
 * Só tipos de `@galaxie/db` e a entrada sem React de `@galaxie/widgets` (`/registry`) entram aqui: o
 * módulo vai para o navegador e para rotas do servidor.
 */
import type { WidgetLocale as PackageLocale } from '@galaxie/widgets';
import {
  REGISTRY_CORE_NAME,
  parseLiveListOptions,
  parseStandingsOptions,
  parseWidgetOptions,
  toRegistryName,
  widgetKindIsMultiSport,
  widgetKindSupportsSport,
} from '@galaxie/widgets/registry';

import type { Locale } from '@/lib/i18n/config';
import { SITE_URL } from '@/lib/site';

import type { WidgetConfig, WidgetDefaults, WidgetEntityType, WidgetKind, WidgetTheme } from './types';

/** Os mesmos de `@galaxie/db` (`WIDGET_KINDS`); o `satisfies` acusa se um tipo sumir de lá. */
export const WIDGET_KINDS = [
  'match_card',
  'match_timeline',
  'live_list',
  'score_ticker',
  'standings',
  'where_to_watch',
  'ai_context',
  'match_stakes',
  'related_videos',
  'head_to_head',
  'team_schedule',
  'team_card',
  'race_result',
  'race_weekend',
  'season_calendar',
  'athlete_profile',
  'fight_card',
  'equestrian_results',
  'equestrian_ranking',
  'equestrian_calendar',
  'rider_profile',
  'horse_profile',
  'medal_table',
  'country_today',
  'games_schedule',
  'country_athletes',
  'medal_history',
  'champions_gallery',
  'competition_leaders',
  'countdown',
  'team_squad',
  'player_profile',
  'lineups',
  'channel_guide',
] as const satisfies readonly WidgetKind[];

/** O que o painel oferece: vídeos fora até decisão do dono (um widget já salvo continua editável). */
export const OFFERED_WIDGET_KINDS = WIDGET_KINDS.filter((kind) => kind !== 'related_videos');

export const isWidgetKind = (v: unknown): v is WidgetKind =>
  typeof v === 'string' && (WIDGET_KINDS as readonly string[]).includes(v);

/** Idiomas do widget (os de `@galaxie/widgets`; o espanhol segue a variante do mercado). */
export const WIDGET_LOCALES = ['pt-BR', 'es', 'en'] as const satisfies readonly PackageLocale[];
export type WidgetLocale = (typeof WIDGET_LOCALES)[number];

/** Idioma da tela da demo → idioma do widget. */
export const toWidgetLocale = (locale: Locale): WidgetLocale => (locale === 'es-AR' ? 'es' : locale);

export const isWidgetLocale = (v: unknown): v is WidgetLocale =>
  typeof v === 'string' && (WIDGET_LOCALES as readonly string[]).includes(v);

/**
 * Entidade padrão que cada tipo aceita, pelas props dos componentes de `@galaxie/widgets` (`eventId`,
 * `competitionId`). O teste confere contra `WIDGET_CATALOG`.
 */
export const ENTITY_TYPES: Record<WidgetKind, readonly WidgetEntityType[]> = {
  match_card: ['event'],
  match_timeline: ['event'],
  live_list: ['competition', 'team'],
  score_ticker: ['competition'],
  standings: ['competition'],
  where_to_watch: ['event'],
  ai_context: ['event'],
  match_stakes: ['event'],
  related_videos: ['event'],
  head_to_head: ['event'],
  team_schedule: ['team'],
  team_card: ['team'],
  race_result: ['event'],
  race_weekend: ['event'],
  season_calendar: ['competition'],
  athlete_profile: ['team'],
  fight_card: ['event'],
  equestrian_results: [],
  equestrian_ranking: [],
  equestrian_calendar: [],
  rider_profile: [],
  horse_profile: [],
  medal_table: [],
  country_today: [],
  games_schedule: [],
  country_athletes: [],
  medal_history: [],
  champions_gallery: ['competition'],
  competition_leaders: ['competition'],
  countdown: ['event'],
  team_squad: ['team'],
  player_profile: ['person'],
  lineups: ['event'],
  channel_guide: [],
};

/**
 * Entidade sem a qual o componente não renderiza (`requiredProps` do catálogo: `eventId` nos widgets de
 * um jogo, `competitionId` na tabela e `teamId` na agenda e no cartão do time). O widget salvo grava a entidade no arquivo instalado e o
 * snippet de uso vai sem props: sem ela, o componente instalado só mostraria erro.
 */
export const REQUIRED_ENTITY: Record<WidgetKind, WidgetEntityType | null> = {
  match_card: 'event',
  match_timeline: 'event',
  live_list: null,
  score_ticker: null,
  standings: 'competition',
  where_to_watch: 'event',
  ai_context: 'event',
  match_stakes: 'event',
  related_videos: 'event',
  head_to_head: 'event',
  team_schedule: 'team',
  team_card: 'team',
  race_result: 'event',
  race_weekend: 'event',
  season_calendar: 'competition',
  athlete_profile: 'team',
  fight_card: 'event',
  equestrian_results: null,
  equestrian_ranking: null,
  equestrian_calendar: null,
  rider_profile: null,
  horse_profile: null,
  medal_table: null,
  country_today: null,
  games_schedule: null,
  country_athletes: null,
  medal_history: null,
  champions_gallery: 'competition',
  competition_leaders: 'competition',
  countdown: 'event',
  team_squad: 'team',
  player_profile: 'person',
  lineups: 'event',
  channel_guide: null,
};

const STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** Fontes do editor (pilhas CSS): a dos temas prontos e famílias comuns do Google Fonts. */
export const FONT_FAMILIES = [
  `Inter, ${STACK}`,
  `Roboto, ${STACK}`,
  `Poppins, ${STACK}`,
  `Montserrat, ${STACK}`,
  `"Open Sans", ${STACK}`,
  `Lato, ${STACK}`,
  STACK,
];

/** Rótulo de uma pilha de fontes: a primeira família (`"Open Sans", ...` → `Open Sans`). */
export const fontLabel = (stack: string) =>
  stack
    .split(',')[0]!
    .trim()
    .replace(/^["']|["']$/g, '');

/** Mercados oferecidos quando o plano não restringe (o plano com mercados mostra só os dele). */
export const DEFAULT_MARKETS = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'PY', 'EC', 'US', 'ES', 'PT'];

/** Mercados que o tenant pode escolher (o primeiro é o padrão de um widget novo). */
export const marketsFor = (tenantMarkets: string[]) =>
  tenantMarkets.length ? tenantMarkets : DEFAULT_MARKETS;

export const RADIUS_MAX = 24;
export const NAME_MAX = 80;
export const MAX_ORIGINS = 20;

/** Variável de ambiente da chave publicável no app da operadora (o registry pede para criá-la). */
export { PUBLISHABLE_KEY_ENV } from '@galaxie/widgets/registry';

/** `#rrggbb` ou, com transparência, `#rrggbbaa`. */
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const COLOR_KEYS = ['primary', 'background', 'surface', 'foreground', 'mutedForeground', 'border'] as const;

/** Tema válido ou null (cores `#rrggbb` ou `#rrggbbaa`, raio 0–24, fonte da lista, densidade e modo conhecidos). */
export function parseTheme(raw: unknown): WidgetTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  for (const k of COLOR_KEYS) if (typeof t[k] !== 'string' || !HEX.test(t[k])) return null;
  const radius = Number(t.radius);
  if (!Number.isFinite(radius) || radius < 0 || radius > RADIUS_MAX) return null;
  // Mesma regra do gerador do registry: texto curto, sem nada que feche a declaração CSS.
  if (typeof t.fontFamily !== 'string' || t.fontFamily.length > 200 || /[;{}<>]/.test(t.fontFamily))
    return null;
  if (t.density !== 'compact' && t.density !== 'comfortable') return null;
  if (t.mode !== 'light' && t.mode !== 'dark') return null;
  const color = (k: (typeof COLOR_KEYS)[number]) => (t[k] as string).toLowerCase();
  return {
    primary: color('primary'),
    background: color('background'),
    surface: color('surface'),
    foreground: color('foreground'),
    mutedForeground: color('mutedForeground'),
    border: color('border'),
    radius: Math.round(radius),
    fontFamily: t.fontFamily,
    density: t.density,
    mode: t.mode,
  };
}

// ─── entidade padrão ⇄ `defaults` ────────────────────────────────────────────────────────────────

const DEFAULT_KEY: Record<WidgetEntityType, 'competitionId' | 'teamId' | 'eventId' | 'personId'> = {
  competition: 'competitionId',
  team: 'teamId',
  event: 'eventId',
  person: 'personId',
};

/** Entidade padrão gravada em `defaults` (a primeira que houver: jogo, time, competição, pessoa). */
export function entityFromDefaults(
  defaults: WidgetDefaults | null | undefined,
): { type: WidgetEntityType; id: string } | null {
  if (defaults?.eventId) return { type: 'event', id: defaults.eventId };
  if (defaults?.teamId) return { type: 'team', id: defaults.teamId };
  if (defaults?.competitionId) return { type: 'competition', id: defaults.competitionId };
  if (defaults?.personId) return { type: 'person', id: defaults.personId };
  return null;
}

/**
 * Recorte padrão gravado no widget: a entidade e, nos tipos de vários esportes (Jogos do dia, placar,
 * tabela...), o esporte escolhido. Nos tipos de um esporte só, o esporte é implícito e não é gravado.
 */
export function defaultsFromEntity(
  entity: { type: WidgetEntityType; id: string } | null,
  sport?: { kind: WidgetKind; sport: string | null },
): WidgetDefaults {
  return {
    ...(entity ? { [DEFAULT_KEY[entity.type]]: entity.id } : {}),
    ...(sport?.sport && widgetKindIsMultiSport(sport.kind) ? { sport: sport.sport } : {}),
  };
}

/** Esporte da API: o mesmo formato de `@galaxie/contracts` (`football`, `formula-1`, `american-football`). */
const SPORT = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Esporte válido gravado no widget (ou null: todos os esportes). */
export function sportOf(kind: WidgetKind, raw: unknown): string | null {
  return typeof raw === 'string' &&
    SPORT.test(raw) &&
    widgetKindIsMultiSport(kind) &&
    widgetKindSupportsSport(kind, raw)
    ? raw
    : null;
}

export { widgetKindSupportsSport };

// ─── validação do que chega do navegador ─────────────────────────────────────────────────────────

/** Ids da API: UUID; competições também aceitam slug. */
const ENTITY_ID = /^[0-9a-z][0-9a-z-]{0,119}$/i;

export type WidgetInputError =
  'kind' | 'name' | 'theme' | 'brandTheme' | 'locale' | 'market' | 'entity' | 'entityRequired' | 'sport';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chaves do tema em que o widget difere do tema da marca (os ajustes só dele). */
export function themeOverridesOf(theme: WidgetTheme, base: WidgetTheme): Partial<WidgetTheme> {
  const out: Partial<WidgetTheme> = {};
  for (const key of Object.keys(base) as (keyof WidgetTheme)[])
    if (theme[key] !== base[key]) (out as Record<string, unknown>)[key] = theme[key];
  return out;
}

/**
 * Ajustes de um widget ligado a tema da marca: só chaves do tema, cada valor válido pelas regras de
 * `parseTheme` (conferido sobre o tema do widget). Ausente = sem ajustes; null se algum é inválido.
 */
export function parseThemeOverrides(raw: unknown, theme: WidgetTheme): Partial<WidgetTheme> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Partial<WidgetTheme> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in theme)) return null;
    const parsed = parseTheme({ ...theme, [key]: value });
    if (!parsed) return null;
    (out as Record<string, unknown>)[key] = parsed[key as keyof WidgetTheme];
  }
  return out;
}

/** Nome de um tema da marca: sem espaços sobrando, 1 a 80 caracteres; null se inválido. */
export function parseBrandThemeName(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return name && name.length <= NAME_MAX ? name : null;
}

export interface WidgetInput {
  kind: WidgetKind;
  name: string;
  config: WidgetConfig;
}

/**
 * Valida o que o navegador mandou para salvar. `markets` = mercados do plano (vazio = qualquer país);
 * `entityTypes` = entidades que o tipo de widget aceita (do catálogo); `sports` = esportes do plano.
 */
export function parseWidgetInput(
  raw: unknown,
  opts: {
    markets: string[];
    entityTypes: (kind: WidgetKind) => readonly WidgetEntityType[];
    /** Esportes do plano (vazio = todos). */
    sports?: string[];
  },
): { ok: true; value: WidgetInput } | { ok: false; error: WidgetInputError } {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!isWidgetKind(r.kind)) return { ok: false, error: 'kind' };
  const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > NAME_MAX) return { ok: false, error: 'name' };
  // "Galaxie Core" viraria o arquivo do núcleo comum e todo /r/<id>.json daria erro
  if (toRegistryName(name) === REGISTRY_CORE_NAME) return { ok: false, error: 'name' };
  const c = (r.config ?? {}) as Record<string, unknown>;
  const theme = parseTheme(c.theme);
  if (!theme) return { ok: false, error: 'theme' };
  // tema da marca: o banco recalcula o tema a partir dele e guarda só o que este widget muda
  const brandThemeId = c.brandThemeId ?? null;
  if (brandThemeId !== null && (typeof brandThemeId !== 'string' || !UUID.test(brandThemeId)))
    return { ok: false, error: 'brandTheme' };
  // só os ajustes que a pessoa fez neste widget (com um tema velho no editor, o resto segue o tema novo)
  const themeOverrides = brandThemeId ? parseThemeOverrides(c.themeOverrides, theme) : null;
  if (brandThemeId && !themeOverrides) return { ok: false, error: 'theme' };
  if (!isWidgetLocale(c.locale)) return { ok: false, error: 'locale' };
  if (typeof c.market !== 'string' || !/^[A-Za-z]{2}$/.test(c.market)) return { ok: false, error: 'market' };
  const market = c.market.toUpperCase();
  if (opts.markets.length && !opts.markets.includes(market)) return { ok: false, error: 'market' };

  const d = (c.defaults ?? {}) as Record<string, unknown>;
  const given = (Object.keys(DEFAULT_KEY) as WidgetEntityType[]).filter((type) => d[DEFAULT_KEY[type]]);
  if (given.length > 1) return { ok: false, error: 'entity' };
  const type = given[0];
  let defaults: WidgetDefaults = {};
  if (type) {
    const id = d[DEFAULT_KEY[type]];
    if (!opts.entityTypes(r.kind).includes(type) || typeof id !== 'string' || !ENTITY_ID.test(id))
      return { ok: false, error: 'entity' };
    defaults = defaultsFromEntity({ type, id });
  } else if (REQUIRED_ENTITY[r.kind]) return { ok: false, error: 'entityRequired' };
  // esporte: só nos tipos de todos os esportes, e no formato da API (`sports` do plano a API confere)
  if (d.sport !== undefined && d.sport !== null) {
    const sport = sportOf(r.kind, d.sport);
    if (!sport || (opts.sports?.length && !opts.sports.includes(sport))) return { ok: false, error: 'sport' };
    defaults = { ...defaults, sport };
  }
  return {
    ok: true,
    value: {
      kind: r.kind,
      name,
      config: {
        theme,
        ...(brandThemeId ? { brandThemeId, themeOverrides: themeOverrides! } : {}),
        locale: c.locale,
        market,
        defaults,
        // legenda e cores das zonas: só na tabela, e só o que for válido (faixa conhecida, `#rrggbb`/`#rrggbbaa`)
        ...(r.kind === 'standings' ? optional('standings', parseStandingsOptions(c.standings)) : {}),
        // modo, agrupamento, atualização e dados extras: só na lista de jogos, e só chaves conhecidas
        ...(r.kind === 'live_list' ? optional('liveList', parseLiveListOptions(c.liveList)) : {}),
        // opções de conteúdo: só as do tipo, válidas e diferentes do padrão
        ...optional('options', parseWidgetOptions(r.kind, c.options)),
      },
    },
  };
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

/**
 * Domínios de uma chave publicável, um por linha (ou separados por vírgula/espaço). Sem esquema vira
 * https (`app.exemplo.com` → `https://app.exemplo.com`). `normalize` é o `normalizeAllowedOrigin` de
 * `@galaxie/db` (a mesma regra que a API usa para conferir o `Origin`).
 */
export function parseOrigins(
  text: string,
  normalize: (pattern: string) => string | null,
): { origins: string[]; invalid: string[] } {
  const origins = new Set<string>();
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const value = normalize(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (value) origins.add(value);
    else invalid.push(raw);
  }
  return { origins: [...origins], invalid };
}

// ─── instalação ──────────────────────────────────────────────────────────────────────────────────

/** Endereço público do registry dos widgets (o domínio da demo). */
export const REGISTRY_BASE_URL = (process.env.NEXT_PUBLIC_GALAXIE_REGISTRY_URL || SITE_URL).replace(
  /\/+$/,
  '',
);

export const registryUrl = (id: string, base = REGISTRY_BASE_URL) => `${base}/r/${id}.json`;

export const installCommand = (id: string, base = REGISTRY_BASE_URL) =>
  `npx shadcn@latest add ${registryUrl(id, base)}`;

/**
 * Embed HTML (qualquer site: WordPress, CMS de portal, HTML puro). O script registra `<galaxie-widget>`, que
 * lê a configuração salva em `/e/<id>.json`; a chave publicável vai no atributo `key` e só funciona nas
 * origens permitidas dela.
 */
export function embedSnippet(id: string, base = REGISTRY_BASE_URL): string {
  return [
    `<script src="${base}/embed.js" async></script>`,
    `<galaxie-widget widget="${id}" key="gs_pk_live_…"></galaxie-widget>`,
  ].join('\n');
}

/** `<uuid>.json` (o segmento da rota) → id do widget, ou null. */
export function parseRegistryParam(param: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i.exec(param);
  return m ? m[1]!.toLowerCase() : null;
}

/** Componente que o arquivo instalado exporta (o `registryComponent` do catálogo de `@galaxie/widgets`). */
export const REGISTRY_COMPONENTS: Record<WidgetKind, string> = {
  match_card: 'GalaxieMatchCard',
  match_timeline: 'GalaxieMatchTimeline',
  live_list: 'GalaxieLiveList',
  score_ticker: 'GalaxieScoreTicker',
  standings: 'GalaxieStandingsTable',
  where_to_watch: 'GalaxieWhereToWatch',
  ai_context: 'GalaxieAiContext',
  match_stakes: 'GalaxieMatchStakes',
  related_videos: 'GalaxieRelatedVideos',
  head_to_head: 'GalaxieHeadToHead',
  team_schedule: 'GalaxieTeamSchedule',
  team_card: 'GalaxieTeamCard',
  race_result: 'GalaxieRaceResult',
  race_weekend: 'GalaxieRaceWeekend',
  season_calendar: 'GalaxieSeasonCalendar',
  athlete_profile: 'GalaxieAthleteProfile',
  fight_card: 'GalaxieFightCard',
  equestrian_results: 'GalaxieEquestrianResults',
  equestrian_ranking: 'GalaxieEquestrianRanking',
  equestrian_calendar: 'GalaxieEquestrianCalendar',
  rider_profile: 'GalaxieRiderProfile',
  horse_profile: 'GalaxieHorseProfile',
  medal_table: 'GalaxieMedalTable',
  country_today: 'GalaxieCountryToday',
  games_schedule: 'GalaxieGamesSchedule',
  country_athletes: 'GalaxieCountryAthletes',
  medal_history: 'GalaxieMedalHistory',
  champions_gallery: 'GalaxieChampionsGallery',
  competition_leaders: 'GalaxieCompetitionLeaders',
  countdown: 'GalaxieCountdown',
  team_squad: 'GalaxieTeamSquad',
  player_profile: 'GalaxiePlayerProfile',
  lineups: 'GalaxieLineups',
  channel_guide: 'GalaxieChannelGuide',
};

/**
 * Como usar o componente instalado. O registry grava o tema, o idioma, o mercado e a entidade padrão no
 * próprio arquivo (`components/galaxie/<nome>.tsx`), então a tag vai sem props.
 */
export function usageSnippet(widget: { kind: WidgetKind; name: string }): string {
  const file = toRegistryName(widget.name) || `galaxie-${widget.kind.replace(/_/g, '-')}`;
  const component = REGISTRY_COMPONENTS[widget.kind];
  return [`import { ${component} } from '@/components/galaxie/${file}';`, ``, `<${component} />`].join('\n');
}
