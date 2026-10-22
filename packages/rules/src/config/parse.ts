import {
  TIE_BREAKER_IDS,
  ZONE_KINDS,
  type CompetitionFormat,
  type CompetitionRules,
  type KnockoutRules,
  type KnockoutStageRules,
  type LeagueRules,
  type StandingsRules,
  type TieBreaker,
  type TieBreakerId,
  type Zone,
  type ZoneKind,
} from './types.js';

/** Erro de regulamento inválido (mensagem voltada a pessoas, em português). */
export class RulesConfigError extends Error {
  override readonly name = 'RulesConfigError';
}

type Raw = Record<string, unknown>;

const FORMATS: readonly CompetitionFormat[] = ['league', 'cup', 'league_phase', 'groups_and_knockout'];

const DEFAULT_STAGE: KnockoutStageRules = {
  legs: 2,
  awayGoals: false,
  awayGoalsInExtraTime: false,
  extraTime: true,
  penalties: true,
  drawAdvantage: null,
  neutralVenue: false,
  decidesTitle: false,
};

const DEFAULT_TIE_BREAKERS: TieBreaker[] = [
  { criterion: 'goal_difference' },
  { criterion: 'goals_for' },
  { criterion: 'wins' },
  { criterion: 'drawing_of_lots' },
];

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merge profundo de objetos crus do YAML; listas e escalares do `patch` substituem os da base. */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch;
  const out: Raw = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(base[key], value);
  return out;
}

function fail(slug: string, message: string): never {
  throw new RulesConfigError(`Regulamento "${slug}": ${message}`);
}

function int(slug: string, field: string, value: unknown, fallback?: number): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    fail(slug, `campo obrigatório ausente: ${field}`);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(slug, `${field} deve ser inteiro`);
  return value;
}

function bool(slug: string, field: string, value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail(slug, `${field} deve ser true/false`);
  return value;
}

function parseTieBreaker(slug: string, value: unknown): TieBreaker {
  const raw: Raw = typeof value === 'string' ? { criterion: value } : isObject(value) ? value : {};
  const criterion = raw.criterion;
  if (typeof criterion !== 'string' || !(TIE_BREAKER_IDS as readonly string[]).includes(criterion)) {
    fail(slug, `critério de desempate desconhecido: ${JSON.stringify(value)}`);
  }
  const tb: TieBreaker = { criterion: criterion as TieBreakerId };
  if (raw.max_teams !== undefined) tb.maxTeams = int(slug, 'max_teams', raw.max_teams);
  if (raw.require_complete !== undefined)
    tb.requireComplete = bool(slug, 'require_complete', raw.require_complete, false);
  return tb;
}

function parseStandings(slug: string, raw: unknown): StandingsRules {
  const s = isObject(raw) ? raw : {};
  const points = isObject(s.points) ? s.points : {};
  const fairPlay = isObject(s.fair_play) ? s.fair_play : {};
  const tieBreakers = Array.isArray(s.tie_breakers)
    ? s.tie_breakers.map((tb) => parseTieBreaker(slug, tb))
    : DEFAULT_TIE_BREAKERS;
  return {
    points: {
      win: int(slug, 'standings.points.win', points.win, 3),
      draw: int(slug, 'standings.points.draw', points.draw, 1),
      loss: int(slug, 'standings.points.loss', points.loss, 0),
    },
    tieBreakers,
    h2hReapply: bool(slug, 'standings.h2h_reapply', s.h2h_reapply, true),
    fairPlay: {
      yellow: int(slug, 'standings.fair_play.yellow', fairPlay.yellow, 1),
      red: int(slug, 'standings.fair_play.red', fairPlay.red, 3),
    },
  };
}

function parseZone(slug: string, raw: unknown): Zone {
  if (!isObject(raw)) fail(slug, 'zona inválida');
  const id = raw.id;
  if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) fail(slug, `id de zona inválido: ${String(id)}`);
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(ZONE_KINDS as readonly string[]).includes(kind)) {
    fail(slug, `tipo de zona inválido em ${id}: ${String(kind)}`);
  }
  const from = int(slug, `zona ${id}.from`, raw.from);
  const to = int(slug, `zona ${id}.to`, raw.to);
  if (from < 1 || to < from) fail(slug, `zona ${id}: faixa ${from}–${to} inválida`);
  return { id, kind: kind as ZoneKind, from, to };
}

function parseLeague(slug: string, raw: unknown): LeagueRules | null {
  if (raw === null || raw === undefined || raw === false) return null;
  if (!isObject(raw)) fail(slug, 'league deve ser um objeto');
  const teams = raw.teams === undefined || raw.teams === null ? null : int(slug, 'league.teams', raw.teams);
  const matchesPerTeam =
    raw.matches_per_team === undefined || raw.matches_per_team === null
      ? null
      : int(slug, 'league.matches_per_team', raw.matches_per_team);
  const zones = Array.isArray(raw.zones) ? raw.zones.map((z) => parseZone(slug, z)) : [];
  const ids = new Set<string>();
  for (const z of zones) {
    if (ids.has(z.id)) fail(slug, `zona duplicada: ${z.id}`);
    ids.add(z.id);
    if (teams !== null && z.to > teams) fail(slug, `zona ${z.id} passa do número de times (${teams})`);
  }
  return {
    teams,
    matchesPerTeam,
    meetingsPerPair: int(slug, 'league.meetings_per_pair', raw.meetings_per_pair, 2),
    title: bool(slug, 'league.title', raw.title, true),
    zones,
  };
}

function parseStage(slug: string, field: string, raw: unknown, base: KnockoutStageRules): KnockoutStageRules {
  const s = isObject(raw) ? raw : {};
  const legs = int(slug, `${field}.legs`, s.legs, base.legs);
  if (legs !== 1 && legs !== 2) fail(slug, `${field}.legs deve ser 1 ou 2`);
  const drawAdvantage = s.draw_advantage === undefined ? base.drawAdvantage : s.draw_advantage;
  if (drawAdvantage !== null && drawAdvantage !== 'home' && drawAdvantage !== 'away') {
    fail(slug, `${field}.draw_advantage deve ser home, away ou null`);
  }
  const stage: KnockoutStageRules = {
    legs,
    awayGoals: bool(slug, `${field}.away_goals`, s.away_goals, base.awayGoals),
    awayGoalsInExtraTime: bool(
      slug,
      `${field}.away_goals_in_extra_time`,
      s.away_goals_in_extra_time,
      base.awayGoalsInExtraTime,
    ),
    extraTime: bool(slug, `${field}.extra_time`, s.extra_time, base.extraTime),
    penalties: bool(slug, `${field}.penalties`, s.penalties, base.penalties),
    drawAdvantage,
    neutralVenue: bool(slug, `${field}.neutral_venue`, s.neutral_venue, base.neutralVenue),
    decidesTitle: bool(slug, `${field}.decides_title`, s.decides_title, base.decidesTitle),
  };
  if (stage.drawAdvantage && stage.legs !== 1) fail(slug, `${field}: draw_advantage só vale para jogo único`);
  if (!stage.penalties && !stage.drawAdvantage && !stage.extraTime) {
    fail(slug, `${field}: sem prorrogação, pênaltis ou vantagem do empate não há como decidir empates`);
  }
  return stage;
}

function parseKnockout(slug: string, raw: unknown): KnockoutRules | null {
  if (raw === null || raw === undefined || raw === false) return null;
  if (!isObject(raw)) fail(slug, 'knockout deve ser um objeto');
  const def = parseStage(slug, 'knockout.default', raw.default, DEFAULT_STAGE);
  const stages: Record<string, KnockoutStageRules> = {};
  if (isObject(raw.stages)) {
    for (const [kind, stage] of Object.entries(raw.stages)) {
      stages[kind] = parseStage(slug, `knockout.stages.${kind}`, stage, def);
    }
  }
  return { default: def, stages };
}

/** Uma exceção por intervalo de temporadas (`seasons: { from, to }`, ambos inclusivos e opcionais). */
function overrideApplies(slug: string, raw: unknown, season: number): boolean {
  if (!isObject(raw) || !isObject(raw.seasons)) fail(slug, 'cada override precisa de seasons: { from?, to? }');
  const from = raw.seasons.from === undefined ? -Infinity : int(slug, 'overrides.seasons.from', raw.seasons.from);
  const to = raw.seasons.to === undefined ? Infinity : int(slug, 'overrides.seasons.to', raw.seasons.to);
  return season >= from && season <= to;
}

/**
 * Valida e normaliza um regulamento cru (objeto vindo do YAML).
 * Com `season`, aplica em ordem as exceções (`overrides`) cujo intervalo contém a temporada.
 */
export function parseCompetitionRules(input: unknown, options: { season?: number } = {}): CompetitionRules {
  if (!isObject(input)) throw new RulesConfigError('Regulamento inválido: esperado um objeto YAML.');
  const slug = input.slug;
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
    throw new RulesConfigError(`Regulamento inválido: slug ausente ou fora do padrão (${String(slug)}).`);
  }
  let raw: Raw = input;
  if (options.season !== undefined && Array.isArray(input.overrides)) {
    for (const ov of input.overrides) {
      if (overrideApplies(slug, ov, options.season)) {
        const { seasons: _seasons, ...patch } = ov as Raw;
        raw = deepMerge(raw, patch) as Raw;
      }
    }
  }
  const format = raw.format ?? 'league';
  if (typeof format !== 'string' || !(FORMATS as readonly string[]).includes(format)) {
    fail(slug, `format inválido: ${String(format)}`);
  }
  const sources = Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string') : [];
  return {
    slug,
    name: typeof raw.name === 'string' ? raw.name : slug,
    format: format as CompetitionFormat,
    season: options.season ?? null,
    standings: parseStandings(slug, raw.standings),
    league: parseLeague(slug, raw.league),
    knockout: parseKnockout(slug, raw.knockout),
    sources,
  };
}

/** Regras de uma fase de mata-mata: a exceção da fase, se houver, senão o padrão da competição. */
export function knockoutStageRules(rules: CompetitionRules, stageKind?: string | null): KnockoutStageRules {
  const ko = rules.knockout ?? { default: DEFAULT_STAGE, stages: {} };
  return (stageKind ? ko.stages[stageKind] : undefined) ?? ko.default;
}

const ORDINAL_KEYS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/**
 * Chave da fase no regulamento: igual ao `kind`, exceto as fases numeradas de copa
 * ("1st Round" → `first_round`), que o YAML nomeia por extenso (ex.: copa-do-brasil).
 */
export function rulesStageKey(kind: string, providerLabel: string | null): string {
  if (kind === 'knockout_round' && providerLabel) {
    const n = /^(\d+)(st|nd|rd|th)\s+round/i.exec(providerLabel.trim())?.[1];
    const key = n ? ORDINAL_KEYS[Number(n) - 1] : undefined;
    if (key) return `${key}_round`;
  }
  return kind;
}
