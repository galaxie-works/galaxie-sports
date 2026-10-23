/**
 * Catálogo das outras 11 APIs da api-sports (issue #16): AFL, beisebol, basquete, F1, handebol, hóquei, MMA,
 * NBA, NFL/futebol americano, rúgbi e vôlei. Cada API tem formato próprio; aqui ficam os perfis (endpoints de
 * referência e chamada de temporada inteira) e a normalização pura para o formato comum (persist.ts).
 * Endpoints e formatos: docs/research/api-sports-outros-esportes.md.
 */
import { isProviderMediaUrl, type ApiSport, type Params } from '@galaxie/apisports-client';
import type { I18nText } from '@galaxie/db';
import { F1_COMPETITION_ID, MMA_COMPETITION_ID } from '@galaxie/providers';
import type { SportCatalogCompetition } from './catalog-config.js';
import { mergeSameYear, seasonLabel, slugify, type ApiSeason } from './football-catalog.js';
import type { CatalogRows, CompetitionRow, CountryRow, ParticipantRow, VenueRow } from './persist.js';

export const OTHER_SPORTS = [
  'afl',
  'baseball',
  'basketball',
  'formula-1',
  'handball',
  'hockey',
  'mma',
  'nba',
  'american-football',
  'rugby',
  'volleyball',
] as const satisfies readonly ApiSport[];
export type OtherSport = (typeof OTHER_SPORTS)[number];

export function isOtherSport(value: string): value is OtherSport {
  return (OTHER_SPORTS as readonly string[]).includes(value);
}

/** Respostas (`response`) já obtidas, por endpoint de referência. */
export type ReferenceResponses = Map<string, unknown>;

export interface BuildContext {
  catalog: SportCatalogCompetition[];
  today: Date;
}

export interface SeasonCall {
  endpoint: string;
  params: Params;
  /** Resposta que não muda mais (sessão encerrada há dias): o que já está no raw vale para sempre. */
  final?: boolean;
}

export interface SportProfile {
  sport: OtherSport;
  /** Endpoints de referência sem parâmetros, buscados no bootstrap (todos entram no raw). */
  reference: readonly string[];
  /** Os que alimentam a normalização (o resto só fica no raw para o espelho). */
  required: readonly string[];
  build(responses: ReferenceResponses, ctx: BuildContext): CatalogRows;
  /** Chamada que traz a temporada inteira de uma competição (flag `--jogos`). */
  seasonCall(competitionProviderId: string, seasonKey: string): SeasonCall;
  /** Classificação da temporada (`standings`; F1 `rankings/drivers` e `rankings/teams`; MMA não tem). */
  standingsCalls(competitionProviderId: string, seasonKey: string): SeasonCall[];
  /**
   * Chamadas por item da temporada, montadas da resposta de `seasonCall` (F1: resultado de cada sessão em
   * `rankings/races?race=`). Vêm depois de todas as temporadas e tabelas, na ordem de prioridade devolvida.
   */
  detailCalls?(seasonResponse: unknown, now: Date): SeasonCall[];
}

// ─── países ──────────────────────────────────────────────────────────────────────────────────────

export interface ProviderCountry {
  name: string;
  code?: string | null;
  flag?: string | null;
}

/** Nomes que são regiões, não países — algumas APIs dão código a eles (ex.: hóquei "Asia" = "AS"). */
const REGIONS = new Set([
  'world',
  'europe',
  'asia',
  'africa',
  'oceania',
  'americas',
  'south-america',
  'north-america',
  'central-america',
  'north-central-america',
]);

/** Mesmo critério do futebol (ISO2 ou "WORLD"), tolerando código em branco e regiões com código. */
export function sportCountryCode(c: ProviderCountry): string {
  const slug = slugify(c.name);
  if (slug === 'world') return 'WORLD';
  const code = c.code?.trim();
  if (REGIONS.has(slug) || !code) return slug.toUpperCase();
  return code.toUpperCase();
}

function countryRows(list: ProviderCountry[]): CountryRow[] {
  const map = new Map<string, CountryRow>();
  for (const c of list) {
    const code = sportCountryCode(c);
    const prev = map.get(code);
    const flag = c.flag && isProviderMediaUrl(c.flag) ? c.flag : null;
    map.set(code, { code, name: { en: c.name.trim() }, flagUrl: prev?.flagUrl ?? flag });
  }
  return [...map.values()];
}

const WORLD: ProviderCountry = { name: 'World', code: null, flag: null };

// ─── ligas (formato v1 clássico, AFL e NFL) ──────────────────────────────────────────────────────

export interface ParsedSeason {
  key: string;
  year: number;
  start: string | null;
  end: string | null;
  current: boolean | undefined;
  coverage: unknown;
}

export interface ParsedLeague {
  id: string;
  name: string;
  type: 'league' | 'cup';
  logo: string | null;
  country: ProviderCountry | null;
  seasons: ParsedSeason[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function parseSeason(raw: Obj): ParsedSeason | undefined {
  const keyValue = raw.season ?? raw.year;
  if (keyValue == null) return undefined;
  const key = String(keyValue);
  const m = /^(\d{4})/.exec(key);
  if (!m) return undefined;
  return {
    key,
    year: Number(m[1]),
    start: str(raw.start),
    end: str(raw.end),
    current: typeof raw.current === 'boolean' ? raw.current : undefined,
    coverage: raw.coverage ?? null,
  };
}

/**
 * Aceita os três formatos de /leagues vistos nas APIs:
 * - NFL (igual ao futebol): `{ league: {id, name, logo}, country, seasons: [{year, ...}] }`;
 * - v1 clássico (basquete, vôlei, handebol...): `{ id, name, type, logo, country, seasons: [{season, ...}] }`;
 * - AFL: uma linha por temporada `{ id, name, logo, season, start, end, current }`.
 */
export function parseLeagues(response: unknown): ParsedLeague[] {
  if (!Array.isArray(response)) return [];
  const byId = new Map<string, ParsedLeague>();
  for (const item of response) {
    if (!isObj(item)) continue;
    const l = isObj(item.league) ? item.league : item;
    if (l.id == null) continue;
    const id = String(l.id);
    const countryObj = isObj(item.country) ? item.country : null;
    const parsed: ParsedLeague = byId.get(id) ?? {
      id,
      name: str(l.name) ?? id,
      type: String(l.type ?? item.type ?? 'league').toLowerCase() === 'cup' ? 'cup' : 'league',
      logo: str(l.logo),
      country:
        countryObj && str(countryObj.name)
          ? { name: String(countryObj.name), code: str(countryObj.code), flag: str(countryObj.flag) }
          : null,
      seasons: [],
    };
    const seasons = Array.isArray(item.seasons) ? item.seasons : [item];
    for (const s of seasons) {
      const season = isObj(s) ? parseSeason(s) : undefined;
      if (season) parsed.seasons.push(season);
    }
    byId.set(id, parsed);
  }
  return [...byId.values()];
}

/** "2024-2025" → "2024/25"; ano simples usa as datas (como no futebol). */
function labelFor(s: ParsedSeason): string {
  const m = /^(\d{4})-(\d{4})$/.exec(s.key);
  if (m) return `${m[1]}/${m[2]!.slice(2)}`;
  return seasonLabel({ year: s.year, start: s.start, end: s.end });
}

function isWithin(today: Date, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const d = today.toISOString().slice(0, 10);
  return start <= d && d <= end;
}

function seasonRows(seasons: ParsedSeason[], today: Date): CompetitionRow['seasons'] {
  // chave do fornecedor por ano (prefere a forma "2024-2025" quando as duas aparecem)
  const keyByYear = new Map<number, ParsedSeason>();
  for (const s of seasons) {
    const prev = keyByYear.get(s.year);
    if (!prev || (s.key.includes('-') && !prev.key.includes('-'))) keyByYear.set(s.year, s);
  }
  const merged = mergeSameYear(
    seasons.map((s): ApiSeason => ({
      year: s.year,
      start: s.start,
      end: s.end,
      current: s.current ?? isWithin(today, s.start, s.end),
      coverage: s.coverage,
    })),
  );
  return merged
    .sort((a, b) => a.year - b.year)
    .map((s) => {
      const parsed = keyByYear.get(s.year)!;
      return {
        year: s.year,
        label: labelFor({ ...parsed, start: s.start, end: s.end }),
        startDate: s.start,
        endDate: s.end,
        current: s.current,
        coverage: s.coverage,
        providerKey: parsed.key,
      };
    });
}

function configById(catalog: SportCatalogCompetition[]): Map<string, SportCatalogCompetition> {
  return new Map(catalog.filter((c) => c.api_sports_id != null).map((c) => [String(c.api_sports_id), c]));
}

function competitionFrom(
  providerId: string,
  name: string,
  type: 'league' | 'cup',
  country: ProviderCountry,
  logo: string | null,
  seasons: CompetitionRow['seasons'],
  cfg: SportCatalogCompetition | undefined,
): CompetitionRow {
  return {
    providerId,
    slug: cfg?.slug ?? `${slugify(country.name)}-${slugify(name)}-${slugify(providerId)}`,
    name,
    labels: (cfg?.labels as I18nText | undefined) ?? null,
    countryCode: sportCountryCode(country),
    type,
    tier: cfg?.tier ?? 3,
    livePriority: cfg?.live_priority ?? 'none',
    prestige: cfg?.prestige ?? 0,
    logoUrl: logo && isProviderMediaUrl(logo) ? logo : null,
    seasons,
  };
}

/** /countries (quando existe) + /leagues → linhas comuns. `fallbackCountry` para APIs sem país (AFL). */
export function buildLeagueCatalog(
  countriesResponse: unknown,
  leaguesResponse: unknown,
  ctx: BuildContext,
  fallbackCountry: ProviderCountry = WORLD,
): CatalogRows {
  const cfgs = configById(ctx.catalog);
  const leagues = parseLeagues(leaguesResponse);
  const providerCountries = (Array.isArray(countriesResponse) ? countriesResponse : [])
    .filter(isObj)
    .filter((c) => str(c.name))
    .map((c): ProviderCountry => ({ name: String(c.name), code: str(c.code), flag: str(c.flag) }));
  const competitions = leagues.map((l) =>
    competitionFrom(
      l.id,
      l.name,
      l.type,
      l.country ?? fallbackCountry,
      l.logo,
      seasonRows(l.seasons, ctx.today),
      cfgs.get(l.id),
    ),
  );
  return {
    countries: countryRows([...providerCountries, ...leagues.map((l) => l.country ?? fallbackCountry)]),
    competitions,
  };
}

// ─── APIs sem entidade de liga com temporadas (F1, MMA, NBA) ─────────────────────────────────────

function yearsFrom(response: unknown): number[] {
  if (!Array.isArray(response)) return [];
  const years = response
    .map((v) => Number(String(v).slice(0, 4)))
    .filter((y) => Number.isInteger(y) && y > 1900);
  return [...new Set(years)].sort((a, b) => a - b);
}

/** Temporadas de APIs que só expõem /seasons (lista de anos): a mais recente é a corrente. */
function syntheticSeasons(years: number[], strategy: string | undefined): CompetitionRow['seasons'] {
  const latest = years.at(-1);
  return years.map((year) => ({
    year,
    label: strategy === 'split-year' ? `${year}/${String(year + 1).slice(2)}` : String(year),
    startDate: null,
    endDate: null,
    current: year === latest,
    coverage: null,
    providerKey: String(year),
  }));
}

function countryFromConfig(name: string | undefined, fallback: ProviderCountry): ProviderCountry {
  if (!name || name === fallback.name) return fallback;
  return name === 'World' ? WORLD : { name, code: null, flag: null };
}

/**
 * F1: não há "campeonato" na API — uma competição sintética por temporada (/seasons); os GPs viram fases
 * (`race_weekend`) e as sessões viram eventos na normalização (`normalize:sports`).
 */
export const F1_CHAMPIONSHIP_ID = F1_COMPETITION_ID;
/** MMA: não há filtro por organização — uma competição sintética com todas as lutas da temporada. */
export const MMA_ALL_FIGHTS_ID = MMA_COMPETITION_ID;

function buildF1(responses: ReferenceResponses, ctx: BuildContext): CatalogRows {
  const cfg = configById(ctx.catalog).get(F1_CHAMPIONSHIP_ID);
  const competition = competitionFrom(
    F1_CHAMPIONSHIP_ID,
    cfg?.name ?? 'Formula 1 World Championship',
    'league',
    countryFromConfig(cfg?.country, WORLD),
    null,
    syntheticSeasons(yearsFrom(responses.get('/seasons')), cfg?.seasons_strategy),
    cfg,
  );
  const teams = (Array.isArray(responses.get('/teams')) ? (responses.get('/teams') as unknown[]) : []).filter(
    isObj,
  );
  const participants: ParticipantRow[] = teams
    .filter((t) => t.id != null && str(t.name))
    .map((t) => ({
      providerId: String(t.id),
      kind: 'constructor',
      name: String(t.name),
      shortName: null,
      code: null,
      countryCode: null,
      logoUrl: str(t.logo) && isProviderMediaUrl(String(t.logo)) ? String(t.logo) : null,
    }));
  const circuits = (
    Array.isArray(responses.get('/circuits')) ? (responses.get('/circuits') as unknown[]) : []
  ).filter(isObj);
  const venues: VenueRow[] = circuits
    .filter((c) => c.id != null && str(c.name))
    .map((c) => {
      const location = isObj(c.competition) && isObj(c.competition.location) ? c.competition.location : {};
      return {
        providerId: String(c.id),
        name: String(c.name),
        city: str(location.city),
        countryName: str(location.country),
        capacity: typeof c.capacity === 'number' ? c.capacity : null,
        imageUrl: str(c.image) && isProviderMediaUrl(String(c.image)) ? String(c.image) : null,
      };
    });
  return { countries: countryRows([WORLD]), competitions: [competition], participants, venues };
}

/**
 * Prioridade das sessões no `rankings/races?race=` (cada sessão é uma chamada): corrida e sprint primeiro,
 * depois a classificação que define o grid, e os treinos por último. Se a cota acabar, o resto fica para o dia seguinte.
 */
const F1_SESSION_PRIORITY: readonly RegExp[] = [
  /^race$/,
  /^sprint$/,
  /^3rd qualifying$/,
  /^3rd sprint shootout$/,
  /qualifying|shootout/,
  /practice/,
];
const F1_FINAL_AFTER_MS = 3 * 86_400_000;

/** Resultado de cada sessão encerrada da temporada (`races?season` → `rankings/races?race=`). */
export function f1ResultCalls(races: unknown, now: Date): SeasonCall[] {
  const sessions = (Array.isArray(races) ? races : []).filter(isObj).flatMap((r) => {
    const type = (str(r.type) ?? '').toLowerCase();
    const priority = F1_SESSION_PRIORITY.findIndex((re) => re.test(type));
    const date = Date.parse(String(r.date ?? ''));
    if (r.id == null || str(r.status) !== 'Completed' || priority < 0 || Number.isNaN(date)) return [];
    return [{ id: String(r.id), priority, date }];
  });
  sessions.sort((a, b) => a.priority - b.priority || a.date - b.date);
  return sessions.map((s) => ({
    endpoint: '/rankings/races',
    params: { race: s.id },
    final: now.getTime() - s.date > F1_FINAL_AFTER_MS,
  }));
}

function buildMma(responses: ReferenceResponses, ctx: BuildContext): CatalogRows {
  const cfg = configById(ctx.catalog).get(MMA_ALL_FIGHTS_ID);
  const competition = competitionFrom(
    MMA_ALL_FIGHTS_ID,
    cfg?.name ?? 'MMA',
    'cup',
    countryFromConfig(cfg?.country, WORLD),
    null,
    syntheticSeasons(yearsFrom(responses.get('/seasons')), cfg?.seasons_strategy),
    cfg,
  );
  return { countries: countryRows([WORLD]), competitions: [competition] };
}

const USA: ProviderCountry = { name: 'USA', code: 'US', flag: 'https://media.api-sports.io/flags/us.svg' };

function buildNba(responses: ReferenceResponses, ctx: BuildContext): CatalogRows {
  const cfgs = configById(ctx.catalog);
  const leagues = Array.isArray(responses.get('/leagues')) ? (responses.get('/leagues') as unknown[]) : [];
  const years = yearsFrom(responses.get('/seasons'));
  const competitions = leagues
    .map((l) => String(l))
    .map((key) => {
      const cfg = cfgs.get(key);
      return competitionFrom(
        key,
        cfg?.name ?? `NBA ${key}`,
        'league',
        countryFromConfig(cfg?.country, USA),
        null,
        syntheticSeasons(years, cfg?.seasons_strategy ?? 'split-year'),
        cfg,
      );
    });
  // logos dos times da NBA v2 apontam para a Wikimedia (licença própria): não entram no Asset Mirror
  const teams = (Array.isArray(responses.get('/teams')) ? (responses.get('/teams') as unknown[]) : []).filter(
    isObj,
  );
  const participants: ParticipantRow[] = teams
    .filter((t) => t.id != null && str(t.name))
    .map((t) => ({
      providerId: String(t.id),
      kind: 'club',
      name: String(t.name),
      shortName: str(t.nickname),
      code: str(t.code),
      countryCode: null,
      logoUrl: str(t.logo) && isProviderMediaUrl(String(t.logo)) ? String(t.logo) : null,
    }));
  return { countries: countryRows([USA]), competitions, participants };
}

// ─── perfis ──────────────────────────────────────────────────────────────────────────────────────

const games = (league: string, season: string): SeasonCall => ({
  endpoint: '/games',
  params: { league, season },
});

const standings = (league: string, season: string): SeasonCall[] => [
  { endpoint: '/standings', params: { league, season } },
];

function classic(sport: OtherSport, odds: readonly string[]): SportProfile {
  return {
    sport,
    reference: ['/timezone', '/seasons', '/countries', '/leagues', ...odds],
    required: ['/countries', '/leagues'],
    build: (r, ctx) => buildLeagueCatalog(r.get('/countries'), r.get('/leagues'), ctx),
    seasonCall: games,
    standingsCalls: standings,
  };
}

const ODDS = ['/odds/bets', '/odds/bookmakers'] as const;

export const SPORT_PROFILES: Record<OtherSport, SportProfile> = {
  baseball: classic('baseball', ODDS),
  // no basquete as casas e apostas ficam fora de /odds/
  basketball: classic('basketball', ['/bookmakers', '/bets']),
  handball: classic('handball', ODDS),
  hockey: classic('hockey', ODDS),
  rugby: classic('rugby', ODDS),
  volleyball: classic('volleyball', ODDS),
  afl: {
    sport: 'afl',
    reference: ['/timezone', '/seasons', '/leagues', ...ODDS],
    required: ['/leagues'],
    build: (r, ctx) =>
      buildLeagueCatalog(undefined, r.get('/leagues'), ctx, {
        name: 'Australia',
        code: 'AU',
        flag: 'https://media.api-sports.io/flags/au.svg',
      }),
    seasonCall: games,
    standingsCalls: standings,
  },
  'american-football': {
    sport: 'american-football',
    reference: ['/timezone', '/seasons', '/leagues', ...ODDS],
    required: ['/leagues'],
    build: (r, ctx) => buildLeagueCatalog(undefined, r.get('/leagues'), ctx),
    seasonCall: games,
    standingsCalls: standings,
  },
  'formula-1': {
    sport: 'formula-1',
    reference: ['/timezone', '/seasons', '/competitions', '/circuits', '/teams'],
    required: ['/seasons', '/circuits', '/teams'],
    build: buildF1,
    // todas as sessões da temporada (treinos, classificação, sprint e corrida)
    seasonCall: (_id, season) => ({ endpoint: '/races', params: { season } }),
    standingsCalls: (_id, season) => [
      { endpoint: '/rankings/drivers', params: { season } },
      { endpoint: '/rankings/teams', params: { season } },
    ],
    // o grid de largada já vem em `grid` no resultado da corrida: `rankings/startinggrid` não gasta cota
    detailCalls: f1ResultCalls,
  },
  mma: {
    sport: 'mma',
    reference: ['/timezone', '/seasons', '/categories', '/teams', ...ODDS],
    required: ['/seasons'],
    build: buildMma,
    seasonCall: (_id, season) => ({ endpoint: '/fights', params: { season } }),
    standingsCalls: () => [],
  },
  nba: {
    sport: 'nba',
    reference: ['/seasons', '/leagues', '/teams'],
    required: ['/seasons', '/leagues', '/teams'],
    build: buildNba,
    seasonCall: games,
    standingsCalls: standings,
  },
};

// ─── conferência do catálogo YAML ────────────────────────────────────────────────────────────────

export interface SportCatalogCheck {
  slug: string;
  apiSportsId: number | string | null;
  status: 'ok' | 'missing' | 'mismatch' | 'unverified';
  details?: string;
  currentSeason?: number | undefined;
}

/** Compara config/competitions/<esporte>.yaml com o que o fornecedor devolveu (ID, nome, país e tipo). */
export function checkSportCatalog(
  catalog: SportCatalogCompetition[],
  rows: CatalogRows,
): SportCatalogCheck[] {
  const byId = new Map(rows.competitions.map((c) => [c.providerId, c]));
  const countryName = new Map(rows.countries.map((c) => [c.code, c.name.en]));
  return catalog.map((c): SportCatalogCheck => {
    if (c.api_sports_id == null) return { slug: c.slug, apiSportsId: null, status: 'unverified' };
    const row = byId.get(String(c.api_sports_id));
    if (!row)
      return {
        slug: c.slug,
        apiSportsId: c.api_sports_id,
        status: 'missing',
        details: 'ID ausente no fornecedor',
      };
    const diffs: string[] = [];
    if (row.name !== c.name) diffs.push(`nome "${row.name}" ≠ "${c.name}"`);
    const country = countryName.get(row.countryCode) ?? row.countryCode;
    if (country !== c.country) diffs.push(`país "${country}" ≠ "${c.country}"`);
    if (row.type !== c.type) diffs.push(`tipo "${row.type}" ≠ "${c.type}"`);
    const currentSeason = row.seasons.find((s) => s.current)?.year;
    return diffs.length
      ? {
          slug: c.slug,
          apiSportsId: c.api_sports_id,
          status: 'mismatch',
          details: diffs.join('; '),
          currentSeason,
        }
      : { slug: c.slug, apiSportsId: c.api_sports_id, status: 'ok', currentSeason };
  });
}

// ─── temporadas inteiras (opcional) ──────────────────────────────────────────────────────────────

export interface SeasonGamesOptions {
  /** Inclui competições até este tier (padrão 1). */
  maxTier?: number;
  /** Janela de temporadas aceita pelo plano (free: 2022–2024). */
  seasonWindow?: { min: number; max: number } | undefined;
  /** Quantas temporadas mais recentes buscar, dentro da janela quando houver (padrão 3). */
  latestSeasons?: number;
  /** Só estas temporadas (ex.: `--temporada 2024`), ainda dentro da janela do plano. */
  seasons?: readonly number[] | undefined;
  /** Também busca a classificação de cada temporada (`standings`; F1 rankings). */
  standings?: boolean | undefined;
}

export interface PlannedSeasonCall extends SeasonCall {
  competition: string;
  season: number;
  /** `season` = a chamada da temporada inteira (dela saem os `detailCalls`); `standings` = classificação. */
  kind: 'season' | 'standings';
}

/**
 * Monta as chamadas `games?league&season` (F1 `races?season`, MMA `fights?season`) das competições prioritárias
 * e, com `standings`, a classificação de cada temporada logo depois de cada uma.
 */
export function planSeasonCalls(
  profile: SportProfile,
  rows: CatalogRows,
  options: SeasonGamesOptions = {},
): PlannedSeasonCall[] {
  const maxTier = options.maxTier ?? 1;
  const out: PlannedSeasonCall[] = [];
  for (const c of rows.competitions) {
    if (c.tier > maxTier) continue;
    const window = options.seasonWindow;
    // janela do plano → as `latestSeasons` mais recentes → só as pedidas (mesma ordem da estimativa)
    const only = options.seasons;
    const inWindow = window
      ? c.seasons.filter((s) => s.year >= window.min && s.year <= window.max)
      : c.seasons;
    const seasons = [...inWindow]
      .sort((a, b) => b.year - a.year)
      .slice(0, options.latestSeasons ?? 3)
      .filter((s) => !only?.length || only.includes(s.year));
    for (const s of seasons.sort((a, b) => a.year - b.year)) {
      const key = s.providerKey ?? String(s.year);
      out.push({
        competition: c.slug,
        season: s.year,
        kind: 'season',
        ...profile.seasonCall(c.providerId, key),
      });
      if (options.standings)
        for (const call of profile.standingsCalls(c.providerId, key))
          out.push({ competition: c.slug, season: s.year, kind: 'standings', ...call });
    }
  }
  return out;
}

/**
 * Estimativa sem o /leagues em mãos (modo plano antes do primeiro bootstrap): usa o YAML e a janela do plano,
 * derivando a chave da temporada de `seasons_strategy` (split-year → "2024-2025").
 */
export function estimateSeasonCalls(
  profile: SportProfile,
  catalog: SportCatalogCompetition[],
  options: SeasonGamesOptions & { currentYear: number },
): PlannedSeasonCall[] {
  const maxTier = options.maxTier ?? 1;
  const latest = options.latestSeasons ?? 3;
  const max = options.seasonWindow?.max ?? options.currentYear;
  const window = { min: Math.max(options.seasonWindow?.min ?? -Infinity, max - latest + 1), max };
  const out: PlannedSeasonCall[] = [];
  for (const c of catalog) {
    if (c.api_sports_id == null || c.tier > maxTier) continue;
    for (let year = window.min; year <= window.max; year++) {
      if (options.seasons?.length && !options.seasons.includes(year)) continue;
      const key =
        c.seasons_strategy === 'split-year' && profile.sport === 'basketball'
          ? `${year}-${year + 1}`
          : String(year);
      out.push({
        competition: c.slug,
        season: year,
        kind: 'season',
        ...profile.seasonCall(String(c.api_sports_id), key),
      });
      if (options.standings)
        for (const call of profile.standingsCalls(String(c.api_sports_id), key))
          out.push({ competition: c.slug, season: year, kind: 'standings', ...call });
    }
  }
  return out;
}
