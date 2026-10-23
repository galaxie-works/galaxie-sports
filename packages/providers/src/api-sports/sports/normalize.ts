/**
 * Normalização pura das 11 APIs da api-sports além do futebol → lote neutro (`NormalizedBatch`), issue #25.
 * Mesmo padrão do futebol: entra o envelope (do raw), sai o que o core deve conter — sem banco e sem rede.
 *
 * - Jogos (`games`, `games/h2h`) de AFL, beisebol, basquete, handebol, hóquei, NBA, NFL, rúgbi e vôlei →
 *   `core.event` com mandante/visitante, placar com parciais (`score.periods`) e o item original em
 *   `core.sport_event_detail`.
 * - F1: cada sessão de `races?season` (treinos, classificação, sprint, corrida) vira evento; o Grande Prêmio
 *   vira `core.stage` (`race_weekend`) da temporada do campeonato sintético; `rankings/races` e
 *   `rankings/startinggrid` completam o evento com os N pilotos (lado `grid`, posição e resultado).
 * - MMA: cada luta de `fights` vira evento com os dois cantos (`corner_red` = `first`, `corner_blue` =
 *   `second`, na ordem do fornecedor) na fase da categoria de peso; `fights/results` soma o desfecho ao espelho.
 * - Classificação (`standings`; F1 `rankings/drivers` e `rankings/teams`) → `core.standing`.
 * - Times (`teams`) → `core.participant`.
 *
 * Formatos conferidos contra respostas reais capturadas (docs/research/api-sports-outros-esportes.md).
 */
import { isProviderMediaUrl } from '@galaxie/apisports-client';
import { expectedEnd } from '../../event/status.js';
import type { EventClock, EventScore, ScorePair, ValidObservation } from '../../event/state-machine.js';
import {
  emptyBatch,
  type I18nText,
  type NormalizedBatch,
  type NormalizedCompetition,
  type NormalizedEvent,
  type NormalizedEventParticipant,
  type NormalizedEventSupplement,
  type NormalizedParticipant,
  type NormalizedVenue,
  type SeasonRef,
  type StageKind,
} from '../../model.js';
import { mergeKnown } from '../football/normalize.js';
import { parseRound } from '../football/round.js';
import {
  mapSportStatus,
  SPORT_EXTRA_TIME_CODES,
  sportStatusDetail,
  type ApiSportsOtherSport,
} from './status.js';

const PROVIDER = 'api-sports';

/** F1: competição sintética do campeonato (mesmo ID do catálogo, `config/competitions/formula-1.yaml`). */
export const F1_COMPETITION_ID = 'world-championship';
/** MMA: competição sintética com todas as lutas (a API não filtra por organização). */
export const MMA_COMPETITION_ID = 'all-fights';
/** Pilotos dividem o espaço de IDs de participante com as equipes (construtores) da F1: prefixo próprio. */
export const F1_DRIVER_PREFIX = 'driver-';

// ─── utilidades ──────────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() ? v.trim() : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const id = (v: unknown): string | null => (v == null ? null : str(v));

/** Primeiro ano de "2024", 2024 ou "2024-2025". */
export function seasonYear(v: unknown): number | null {
  const m = /^(\d{4})/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

/** "2024-2025" → "2024/25"; ano simples → null (o upsert usa o ano). */
function splitSeasonLabel(v: unknown): string | null {
  const m = /^(\d{4})-(\d{4})$/.exec(String(v ?? ''));
  return m ? `${m[1]}/${m[2]!.slice(2)}` : null;
}

/** Só a CDN da api-sports entra no espelho de assets (NBA v2 aponta para a Wikimedia, com licença própria). */
function media(url: unknown): string | null {
  const u = str(url);
  return u && isProviderMediaUrl(u) ? u : null;
}

/** Instante do evento: `timestamp` (número ou texto, em segundos) ou a data ISO. */
function instant(timestamp: unknown, date: unknown): Date | null {
  const ts = num(timestamp);
  if (ts != null && ts > 0) return new Date(ts * 1000);
  const d = str(date);
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Semana ISO (1–53) — ordena os GPs: treinos e corrida caem na mesma semana. */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

function pair(home: unknown, away: unknown): ScorePair | null {
  const h = int(home);
  const a = int(away);
  return h == null && a == null ? null : { home: h, away: a };
}

/** Parciais só com os períodos informados; nenhum → `null`. */
function periods(entries: [string, ScorePair | null][]): Record<string, ScorePair> | null {
  const out: Record<string, ScorePair> = {};
  for (const [k, v] of entries) if (v) out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** "1-0" (hóquei) → { home: 1, away: 0 }. */
function dashPair(v: unknown): ScorePair | null {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(v ?? ''));
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}

// ─── coletor com deduplicação ────────────────────────────────────────────────────────────────────

interface StageSpec {
  label: string;
  kind: StageKind;
  name: I18nText;
  order: number;
}

interface CompetitionSpec {
  id: string;
  name: string;
  type?: 'league' | 'cup' | 'tournament';
  countryName?: string | null;
  countryCode?: string | null;
  logoUrl?: string | null;
  year: number;
  label?: string | null;
}

class SportCollector {
  readonly batch: NormalizedBatch;
  private readonly competitions = new Map<string, NormalizedCompetition>();
  private readonly venues = new Map<string, NormalizedVenue>();
  private readonly participants = new Map<string, NormalizedParticipant>();
  private readonly stages = new Set<string>();
  private readonly supplements = new Map<string, NormalizedEventSupplement>();

  constructor(
    readonly sport: ApiSportsOtherSport,
    observedAt: Date,
  ) {
    this.batch = emptyBatch(PROVIDER, sport, observedAt);
  }

  competition(c: CompetitionSpec): SeasonRef {
    const prev = this.competitions.get(c.id);
    const seasons = prev?.seasons ?? [];
    const known = seasons.find((s) => s.year === c.year);
    if (!known) seasons.push({ year: c.year, label: c.label ?? null, startDate: null, endDate: null });
    else if (!known.label && c.label) known.label = c.label;
    this.competitions.set(c.id, {
      id: c.id,
      name: c.name,
      type: c.type ?? prev?.type ?? 'league',
      countryName: c.countryName ?? prev?.countryName ?? null,
      countryCode: c.countryCode ?? prev?.countryCode ?? null,
      logoUrl: c.logoUrl ?? prev?.logoUrl ?? null,
      seasons,
    });
    return { competitionId: c.id, year: c.year };
  }

  /** Amplia a janela da temporada com a data de um evento (APIs sem datas de temporada, ex.: F1). */
  seasonDate(season: SeasonRef, day: string): void {
    const s = this.competitions.get(season.competitionId)?.seasons.find((x) => x.year === season.year);
    if (!s) return;
    if (!s.startDate || day < s.startDate) s.startDate = day;
    if (!s.endDate || day > s.endDate) s.endDate = day;
  }

  stage(season: SeasonRef, spec: StageSpec | null): string | null {
    if (!spec) return null;
    const key = `${season.competitionId}|${season.year}|${spec.label}`;
    if (!this.stages.has(key)) {
      this.stages.add(key);
      this.batch.stages.push({
        season,
        providerLabel: spec.label,
        kind: spec.kind,
        name: spec.name,
        order: spec.order,
      });
    }
    return spec.label;
  }

  venue(v: NormalizedVenue): string {
    this.venues.set(v.id, mergeKnown(this.venues.get(v.id), v));
    return v.id;
  }

  participant(p: NormalizedParticipant): string {
    this.participants.set(p.id, mergeKnown(this.participants.get(p.id), p));
    return p.id;
  }

  /** Time citado num jogo ou numa tabela: só preenche lacunas do cadastro (`teams`). */
  team(ref: unknown): string | null {
    const t = obj(ref);
    const pid = id(t.id);
    const name = str(t.name);
    if (!pid || !name) return null;
    return this.participant({
      id: pid,
      kind: null,
      name,
      shortName: str(t.nickname),
      code: str(t.code),
      countryName: null,
      countryCode: null,
      founded: null,
      venueId: null,
      logoUrl: media(t.logo),
      reference: true,
    });
  }

  supplement(eventId: string): NormalizedEventSupplement {
    let s = this.supplements.get(eventId);
    if (!s) {
      s = { eventId, participants: [], detail: null };
      this.supplements.set(eventId, s);
    }
    return s;
  }

  done(): NormalizedBatch {
    this.batch.competitions = [...this.competitions.values()];
    this.batch.venues = [...this.venues.values()];
    this.batch.participants = [...this.participants.values()];
    this.batch.eventSupplements = [...this.supplements.values()];
    return this.batch;
  }
}

// ─── fases (rodadas) dos esportes coletivos ──────────────────────────────────────────────────────

function fromRound(label: string): StageSpec {
  const r = parseRound(label);
  return { label, kind: r.kind, name: r.name, order: r.order };
}

/** "NBA - Semi-finals" → "Semi-finals" (o basquete repete o nome da liga na fase). */
function withoutLeaguePrefix(label: string): string {
  const m = /^(.+?)\s+-\s+(\D.*)$/.exec(label);
  return m ? m[2]!.trim() : label;
}

/** Rodada/fase dos esportes v1 (`week`, `stage`; AFL `round` + `week`). */
export function roundStage(raw: { round?: unknown; stage?: unknown; week?: unknown }): StageSpec | null {
  const round = str(raw.round);
  const week = str(raw.week);
  if (round) {
    const playoffs = /post\s*season/i.test(round);
    const base = playoffs ? 'Play-offs' : round;
    return fromRound(week != null && /^\d+$/.test(week) ? `${base} - ${week}` : base);
  }
  if (week && /^\d+$/.test(week)) return fromRound(`Regular Season - ${week}`);
  const label = week ?? str(raw.stage);
  return label ? fromRound(withoutLeaguePrefix(label)) : null;
}

const NFL_POSTSEASON: Readonly<Record<string, { kind: StageKind; pt: string; es: string; n: number }>> = {
  'wild card': { kind: 'knockout_round', pt: 'Wild Card', es: 'Wild Card', n: 1 },
  'divisional round': { kind: 'quarter_final', pt: 'Rodada divisional', es: 'Ronda divisional', n: 2 },
  'conference championships': {
    kind: 'semi_final',
    pt: 'Finais de conferência',
    es: 'Finales de conferencia',
    n: 3,
  },
  'super bowl': { kind: 'final', pt: 'Super Bowl', es: 'Super Bowl', n: 4 },
  'pro bowl': { kind: 'friendly', pt: 'Pro Bowl', es: 'Pro Bowl', n: 0 },
};

/** NCAA: a divisão vem em `stage`; a ordem segue FBS, FCS e Divisões II/III. */
const NCAA_DIVISIONS: readonly { test: RegExp; pt: string; es: string }[] = [
  { test: /^FBS\b/i, pt: 'FBS', es: 'FBS' },
  { test: /^FCS\b/i, pt: 'FCS', es: 'FCS' },
  { test: /division\s+II/i, pt: 'Divisões II/III', es: 'Divisiones II/III' },
];

/**
 * NFL: `stage` (Pre Season, Regular Season, Post Season) + `week` ("Week 3", "Wild Card"...).
 * NCAA: `stage` é a divisão ("FBS (Division I-A)") + `week` ("1"…"16", "Bowls").
 */
export function nflStage(stageRaw: unknown, weekRaw: unknown): StageSpec | null {
  const stage = str(stageRaw);
  const week = str(weekRaw);
  if (!stage && !week) return null;
  const label = [stage, week].filter(Boolean).join(' - ');
  const n = week ? (/(\d+)/.exec(week)?.[1] ?? null) : null;
  const division = NCAA_DIVISIONS.findIndex((d) => d.test.test(stage ?? ''));
  if (division >= 0) {
    const d = NCAA_DIVISIONS[division]!;
    if (n == null)
      return {
        label,
        kind: 'playoff',
        name: {
          'pt-BR': `${d.pt} · ${week ?? 'Pós-temporada'}`,
          es: `${d.es} · ${week ?? 'Postemporada'}`,
          en: label,
        },
        order: 4000 + division,
      };
    return {
      label,
      kind: 'regular',
      name: { 'pt-BR': `${d.pt} · Semana ${n}`, es: `${d.es} · Semana ${n}`, en: label },
      order: 2000 + division * 100 + Number(n),
    };
  }
  const weekName = (pt: string, es: string) =>
    n != null ? { pt: `${pt} · Semana ${n}`, es: `${es} · Semana ${n}` } : { pt, es };
  if (/pre\s*season/i.test(stage ?? '')) {
    const nm = weekName('Pré-temporada', 'Pretemporada');
    return { label, kind: 'friendly', name: { 'pt-BR': nm.pt, es: nm.es, en: label }, order: Number(n ?? 0) };
  }
  if (/post\s*season/i.test(stage ?? '')) {
    const p = NFL_POSTSEASON[(week ?? '').toLowerCase()];
    return {
      label,
      kind: p?.kind ?? 'playoff',
      name: { 'pt-BR': p?.pt ?? 'Playoffs', es: p?.es ?? 'Playoffs', en: label },
      order: 4000 + (p?.n ?? 0),
    };
  }
  return {
    label,
    kind: 'regular',
    name: {
      'pt-BR': n != null ? `Semana ${n}` : 'Temporada regular',
      es: n != null ? `Semana ${n}` : 'Temporada regular',
      en: label,
    },
    order: 2000 + Number(n ?? 0),
  };
}

/** NBA v2: `stage` numérico — 1 pré-temporada, 2 temporada regular, 3+ play-in/playoffs (a confirmar com dados reais). */
export function nbaStage(stageRaw: unknown): StageSpec | null {
  const n = int(stageRaw);
  if (n == null) return null;
  if (n === 1)
    return {
      label: 'stage-1',
      kind: 'friendly',
      name: { 'pt-BR': 'Pré-temporada', es: 'Pretemporada', en: 'Pre-season' },
      order: 0,
    };
  if (n === 2)
    return {
      label: 'stage-2',
      kind: 'regular',
      name: { 'pt-BR': 'Temporada regular', es: 'Temporada regular', en: 'Regular season' },
      order: 2000,
    };
  return {
    label: `stage-${n}`,
    kind: 'playoff',
    name: { 'pt-BR': 'Playoffs', es: 'Playoffs', en: 'Playoffs' },
    order: 4000 + n,
  };
}

// ─── jogos dos esportes coletivos ────────────────────────────────────────────────────────────────

interface GameView {
  id: string;
  startsAt: Date;
  status: { short: unknown; long: unknown; timer: unknown };
  competition: CompetitionSpec;
  home: unknown;
  away: unknown;
  score: EventScore;
  stage: StageSpec | null;
  clock: EventClock | null;
}

const LEAGUE_FALLBACK_NAME: Partial<Record<ApiSportsOtherSport, string>> = { afl: 'AFL Premiership' };

function leagueSpec(
  sport: ApiSportsOtherSport,
  league: Obj,
  country: Obj,
  year: number,
  seasonRaw: unknown,
): CompetitionSpec | null {
  const lid = id(league.id);
  if (!lid) return null;
  return {
    id: lid,
    name: str(league.name) ?? LEAGUE_FALLBACK_NAME[sport] ?? `${sport} ${lid}`,
    type: String(league.type ?? '').toLowerCase() === 'cup' ? 'cup' : 'league',
    countryName: str(country.name) ?? (sport === 'afl' ? 'Australia' : null),
    countryCode: str(country.code)?.toUpperCase() ?? (sport === 'afl' ? 'AU' : null),
    logoUrl: media(league.logo),
    year,
    label: splitSeasonLabel(seasonRaw),
  };
}

/** Placar de um jogo v1 (`scores` + `periods`) conforme o esporte. */
function classicScore(sport: ApiSportsOtherSport, g: Obj): EventScore {
  const scores = obj(g.scores);
  const h = obj(scores.home);
  const a = obj(scores.away);
  const p = obj(g.periods);
  const side = (k: string) => pair(obj(p[k]).home, obj(p[k]).away);
  switch (sport) {
    case 'basketball':
    case 'american-football':
      return {
        home: int(h.total),
        away: int(a.total),
        periods: periods([
          ['q1', pair(h.quarter_1, a.quarter_1)],
          ['q2', pair(h.quarter_2, a.quarter_2)],
          ['q3', pair(h.quarter_3, a.quarter_3)],
          ['q4', pair(h.quarter_4, a.quarter_4)],
          ['ot', pair(h.over_time ?? h.overtime, a.over_time ?? a.overtime)],
        ]),
      };
    case 'baseball': {
      const hi = obj(h.innings);
      const ai = obj(a.innings);
      const innings: [string, ScorePair | null][] = [];
      for (let i = 1; i <= 9; i++) innings.push([`i${i}`, pair(hi[String(i)], ai[String(i)])]);
      innings.push(['extra', pair(hi.extra, ai.extra)]);
      return {
        home: int(h.total),
        away: int(a.total),
        periods: periods(innings),
        breakdown: {
          home: { hits: int(h.hits), errors: int(h.errors) },
          away: { hits: int(a.hits), errors: int(a.errors) },
        },
      };
    }
    case 'afl':
      return {
        home: int(h.score),
        away: int(a.score),
        breakdown: {
          home: {
            goals: int(h.goals),
            behinds: int(h.behinds),
            psgoals: int(h.psgoals),
            psbehinds: int(h.psbehinds),
          },
          away: {
            goals: int(a.goals),
            behinds: int(a.behinds),
            psgoals: int(a.psgoals),
            psbehinds: int(a.psbehinds),
          },
        },
      };
    case 'hockey':
      return {
        home: int(scores.home),
        away: int(scores.away),
        periods: periods([
          ['p1', dashPair(p.first)],
          ['p2', dashPair(p.second)],
          ['p3', dashPair(p.third)],
          ['ot', dashPair(p.overtime)],
          ['so', dashPair(p.penalties)],
        ]),
      };
    case 'volleyball':
      // `scores` = sets vencidos; os pontos de cada set ficam em `periods`
      return {
        home: int(scores.home),
        away: int(scores.away),
        periods: periods([
          ['s1', side('first')],
          ['s2', side('second')],
          ['s3', side('third')],
          ['s4', side('fourth')],
          ['s5', side('fifth')],
        ]),
      };
    case 'handball': {
      // só os dois tempos vêm em `periods`; num AET o placar final inclui a prorrogação, que sai da diferença.
      // Num AP a diferença mistura prorrogação e tiros de 7 m (e no mata-mata em dois jogos é só a disputa),
      // então fica de fora.
      const home = int(scores.home);
      const away = int(scores.away);
      const h1 = side('first');
      const h2 = side('second');
      let ot: ScorePair | null = null;
      if (String(obj(g.status).short ?? '').toUpperCase() === 'AET' && home != null && away != null) {
        const rest = (total: number, k: 'home' | 'away') =>
          h1?.[k] != null && h2?.[k] != null ? total - h1[k] - h2[k] : null;
        const extra = { home: rest(home, 'home'), away: rest(away, 'away') };
        if (extra.home != null && extra.away != null && extra.home >= 0 && extra.away >= 0)
          ot = extra.home + extra.away > 0 ? extra : null;
      }
      // `halftime`/`extratime` com o mesmo sentido do futebol (placar no intervalo; gols só da prorrogação)
      return {
        home,
        away,
        ...(h1 ? { halftime: h1 } : {}),
        extratime: ot,
        periods: periods([
          ['h1', h1],
          ['h2', h2],
          ['ot', ot],
        ]),
      };
    }
    default:
      // rúgbi: dois tempos e prorrogações
      return {
        home: int(scores.home),
        away: int(scores.away),
        periods: periods([
          ['h1', side('first')],
          ['h2', side('second')],
          ['ot', side('overtime')],
          ['ot2', side('second_overtime')],
        ]),
      };
  }
}

function clockOf(short: unknown, timer: unknown): EventClock | null {
  const period = str(short);
  const minute = int(timer);
  return period || minute != null ? { minute, extra: null, period } : null;
}

function gameView(sport: ApiSportsOtherSport, raw: unknown): GameView | null {
  const g = obj(raw);
  if (sport === 'nba') {
    const gid = id(g.id);
    const year = int(g.season);
    const leagueKey = str(g.league);
    const startsAt = instant(null, obj(g.date).start);
    if (!gid || year == null || !leagueKey || !startsAt) return null;
    const scores = obj(g.scores);
    const h = obj(scores.home);
    const v = obj(scores.visitors);
    const hl = Array.isArray(h.linescore) ? h.linescore : [];
    const vl = Array.isArray(v.linescore) ? v.linescore : [];
    const quarters: [string, ScorePair | null][] = [];
    for (let i = 0; i < Math.max(hl.length, vl.length); i++)
      quarters.push([i < 4 ? `q${i + 1}` : `ot${i - 3}`, pair(hl[i], vl[i])]);
    const status = obj(g.status);
    const per = obj(g.periods);
    const current = int(per.current);
    return {
      id: gid,
      startsAt,
      status: { short: status.short, long: status.long, timer: null },
      competition: {
        id: leagueKey,
        name: `NBA ${leagueKey}`,
        countryName: 'USA',
        countryCode: 'US',
        year,
        label: `${year}/${String(year + 1).slice(2)}`,
      },
      home: obj(g.teams).home,
      away: obj(g.teams).visitors,
      score: { home: int(h.points), away: int(v.points), periods: periods(quarters) },
      stage: nbaStage(g.stage),
      clock: current
        ? { minute: null, extra: null, period: current > 4 ? `OT${current - 4}` : `Q${current}` }
        : null,
    };
  }
  if (sport === 'american-football') {
    const game = obj(g.game);
    const date = obj(game.date);
    const league = obj(g.league);
    const gid = id(game.id);
    const year = seasonYear(league.season);
    const startsAt = instant(
      date.timestamp,
      date.date ? `${String(date.date)}T${String(date.time ?? '00:00')}:00Z` : null,
    );
    if (!gid || year == null || !startsAt) return null;
    const competition = leagueSpec(sport, league, obj(league.country), year, league.season);
    if (!competition) return null;
    const status = obj(game.status);
    return {
      id: gid,
      startsAt,
      status: { short: status.short, long: status.long, timer: status.timer },
      competition,
      home: obj(g.teams).home,
      away: obj(g.teams).away,
      score: classicScore(sport, g),
      stage: nflStage(game.stage, game.week),
      clock: clockOf(status.short, status.timer),
    };
  }
  // AFL aninha o id em `game`; os demais (v1 clássico) têm `id` no topo
  const gid = id(sport === 'afl' ? obj(g.game).id : g.id);
  const league = obj(g.league);
  const year = seasonYear(league.season);
  const startsAt = instant(g.timestamp, g.date);
  if (!gid || year == null || !startsAt) return null;
  const competition = leagueSpec(sport, league, obj(g.country), year, league.season);
  if (!competition) return null;
  const status = obj(g.status);
  return {
    id: gid,
    startsAt,
    status: { short: status.short, long: status.long, timer: status.timer ?? g.timer },
    competition,
    home: obj(g.teams).home,
    away: obj(g.teams).away,
    score: classicScore(sport, g),
    stage: roundStage({ round: g.round, stage: g.stage, week: g.week }),
    clock: clockOf(status.short, status.timer ?? g.timer),
  };
}

function winnerOf(score: EventScore, finished: boolean): { home: boolean | null; away: boolean | null } {
  if (!finished || score.home == null || score.away == null || score.home === score.away)
    return { home: null, away: null };
  return { home: score.home > score.away, away: score.away > score.home };
}

function addGame(c: SportCollector, raw: unknown, observedAt: Date): NormalizedEvent | null {
  const v = gameView(c.sport, raw);
  if (!v) return null;
  const season = c.competition(v.competition);
  const stageLabel = c.stage(season, v.stage);
  const statusInput = { short: str(v.status.short), long: str(v.status.long) };
  let status = mapSportStatus(c.sport, statusInput);
  const nbaStatus = obj(obj(raw).status);
  if (
    c.sport === 'nba' &&
    status === 'live' &&
    (nbaStatus.halftime === true || obj(obj(raw).periods).endOfPeriod === true)
  )
    status = 'break';
  const detail =
    c.sport === 'nba'
      ? (str(v.status.long) ?? sportStatusDetail(statusInput))
      : sportStatusDetail(statusInput);
  const short = String(v.status.short ?? '').toUpperCase();
  const extraTime =
    SPORT_EXTRA_TIME_CODES.has(short) ||
    v.score.periods?.ot != null ||
    v.score.periods?.extra != null ||
    v.score.periods?.so != null ||
    /over\s*time|extra|\/\d*ot/i.test(String(v.status.long ?? ''));
  const observation: ValidObservation = {
    kind: 'valid',
    observedAt,
    status,
    statusDetail: detail,
    clock: v.clock,
    score: v.score,
    startsAt: v.startsAt,
    endsAtExpected: expectedEnd({ sport: c.sport, startsAt: v.startsAt, extraTime }),
  };
  const winner = winnerOf(v.score, status === 'finished');
  const participants: NormalizedEventParticipant[] = [];
  for (const [side, ref] of [
    ['home', v.home],
    ['away', v.away],
  ] as const) {
    const pid = c.team(ref);
    if (pid)
      participants.push({
        participantId: pid,
        side,
        position: null,
        result: { score: v.score[side], winner: winner[side] },
      });
  }
  return {
    id: v.id,
    competitionId: season.competitionId,
    season,
    stageLabel,
    venueId: null,
    observation,
    participants,
    sportEvent: { providerEventId: v.id, kind: 'game', summary: obj(raw), detail: null },
  };
}

export function normalizeSportGames(
  sport: ApiSportsOtherSport,
  items: unknown[],
  observedAt: Date,
): NormalizedBatch {
  const c = new SportCollector(sport, observedAt);
  const byId = new Map<string, NormalizedEvent>();
  for (const item of items) {
    const e = addGame(c, item, observedAt);
    if (e) byId.set(e.id, e);
  }
  c.batch.events = [...byId.values()];
  return c.done();
}

// ─── times ───────────────────────────────────────────────────────────────────────────────────────

/** `teams` (v1 clássico, AFL, NFL e NBA v2) → participantes completos. */
export function normalizeSportTeams(
  sport: ApiSportsOtherSport,
  items: unknown[],
  observedAt: Date,
): NormalizedBatch {
  const c = new SportCollector(sport, observedAt);
  for (const raw of items) {
    const t = obj(raw);
    const pid = id(t.id);
    const name = str(t.name);
    if (!pid || !name) continue;
    const country = obj(t.country);
    c.participant({
      id: pid,
      kind: sport === 'formula-1' ? 'constructor' : t.national === true ? 'national_team' : 'club',
      name,
      shortName: str(t.nickname),
      code: str(t.code),
      countryName: str(country.name),
      countryCode: str(country.code)?.toUpperCase() ?? null,
      founded: int(t.established ?? t.founded),
      venueId: null,
      logoUrl: media(t.logo),
    });
  }
  return c.done();
}

// ─── classificação ───────────────────────────────────────────────────────────────────────────────

/** Total de um contador que vem como número (AFL) ou `{ total }` (v1 clássico). */
const total = (v: unknown): number | null => (isObj(v) ? int(v.total) : int(v));

const NFL_CONFERENCES: Readonly<Record<string, string>> = {
  'american football conference': 'AFC',
  'national football conference': 'NFC',
};

/**
 * Grupo da classificação do futebol americano: a divisão sozinha se repete entre conferências (NFL 2022
 * devolve "East" na AFC e na NFC; a NCAA tem "East"/"West" em várias conferências e "Main" quando não há
 * divisão). NFL → "AFC East"; NCAA → "Big Ten · East" ou só "Big Ten".
 */
export function americanFootballGroup(conferenceRaw: unknown, divisionRaw: unknown): string {
  const conference = str(conferenceRaw);
  const division = str(divisionRaw);
  const nfl = conference ? NFL_CONFERENCES[conference.toLowerCase()] : undefined;
  if (nfl) return !division || division.startsWith(nfl) ? (division ?? nfl) : `${nfl} ${division}`;
  if (!conference) return division ?? '';
  return !division || /^main$/i.test(division) ? conference : `${conference} · ${division}`;
}

export function normalizeSportStandings(
  sport: ApiSportsOtherSport,
  items: unknown[],
  observedAt: Date,
  params: Record<string, string> = {},
): NormalizedBatch {
  const c = new SportCollector(sport, observedAt);
  const rows = items.flatMap((i) => (Array.isArray(i) ? i : [i])).map(obj);
  // mais de uma fase na mesma resposta (ex.: temporada regular + playoffs): a fase entra no grupo
  const stages = new Set(rows.map((r) => str(r.stage)).filter(Boolean));
  for (const row of rows) {
    const participantId = c.team(row.team);
    if (!participantId) continue;

    let competition: CompetitionSpec | null;
    let group: string;
    let rank: number | null;
    let won: number;
    let drawn: number;
    let lost: number;
    let points: number | null;
    let goalsFor: number;
    let goalsAgainst: number;
    let form: string | null = null;
    let description: string | null = null;

    if (sport === 'nba') {
      const year = int(row.season) ?? seasonYear(params.season);
      const key = str(row.league) ?? str(params.league);
      if (year == null || !key) continue;
      competition = { id: key, name: `NBA ${key}`, countryName: 'USA', countryCode: 'US', year };
      const conf = obj(row.conference);
      const win = obj(row.win);
      const loss = obj(row.loss);
      group = str(conf.name) ?? '';
      rank = int(conf.rank);
      // o total às vezes vem zerado: soma casa + fora
      won = int(win.total) || (int(win.home) ?? 0) + (int(win.away) ?? 0);
      lost = int(loss.total) || (int(loss.home) ?? 0) + (int(loss.away) ?? 0);
      drawn = 0;
      points = won;
      goalsFor = 0;
      goalsAgainst = 0;
    } else if (sport === 'american-football') {
      const league = obj(row.league);
      const year = seasonYear(league.season) ?? seasonYear(params.season);
      if (year == null) continue;
      competition = leagueSpec(sport, league, obj(league.country), year, league.season);
      group = americanFootballGroup(row.conference, row.division);
      rank = int(row.position);
      won = int(row.won) ?? 0;
      lost = int(row.lost) ?? 0;
      drawn = int(row.ties) ?? 0;
      points = won;
      goalsFor = int(obj(row.points).for) ?? 0;
      goalsAgainst = int(obj(row.points).against) ?? 0;
      form = str(row.streak);
    } else {
      const league = obj(row.league);
      const year = seasonYear(league.season) ?? seasonYear(params.season);
      if (year == null) continue;
      competition = leagueSpec(
        sport,
        Object.keys(league).length ? league : { id: params.league },
        obj(row.country),
        year,
        league.season ?? params.season,
      );
      const groupName = str(obj(row.group).name);
      const stage = str(row.stage);
      group = (stages.size > 1 ? [stage, groupName] : [groupName ?? stage]).filter(Boolean).join(' · ');
      rank = int(row.position);
      const games = obj(row.games);
      // hóquei separa vitórias/derrotas na prorrogação
      won = (total(games.win) ?? 0) + (total(games.win_overtime) ?? 0);
      drawn = total(games.draw) ?? total(games.drawn) ?? 0;
      lost = (total(games.lose) ?? total(games.lost) ?? 0) + (total(games.lose_overtime) ?? 0);
      // sem pontos numéricos (basquete, beisebol) a tabela é por vitórias
      points = int(row.points) ?? int(row.pts) ?? won;
      const gf = isObj(row.goals) ? row.goals : isObj(row.points) ? row.points : obj(row.scores);
      goalsFor = int(gf.for) ?? 0;
      goalsAgainst = int(gf.against) ?? 0;
      form = str(row.form) ?? str(row.last_5);
      description = str(row.description);
    }
    if (!competition || rank == null) continue;
    const season = c.competition(competition);
    c.batch.standings.push({
      season,
      group,
      participantId,
      rank,
      points: points ?? 0,
      played: total(obj(row.games).played) ?? won + drawn + lost,
      won,
      drawn,
      lost,
      goalsFor,
      goalsAgainst,
      form,
      description,
    });
  }
  return c.done();
}

// ─── Fórmula 1 ───────────────────────────────────────────────────────────────────────────────────

function f1Season(c: SportCollector, year: number): SeasonRef {
  return c.competition({
    id: F1_COMPETITION_ID,
    name: 'Formula 1 World Championship',
    countryName: 'World',
    year,
  });
}

/** Duração de cada tipo de sessão (min). Q1/Q2/Q3 e SQ1/SQ2/SQ3 vêm como sessões separadas. */
export function f1SessionMinutes(type: string | null): number {
  const t = (type ?? '').toLowerCase();
  if (t === 'race') return 120;
  if (/sprint shootout/.test(t)) return 20;
  if (t === 'sprint') return 60;
  if (/^\d+(st|nd|rd|th) qualifying$/.test(t)) return 25;
  if (/qualifying/.test(t)) return 60;
  if (/practice/.test(t)) return 60;
  return 120;
}

function f1Driver(c: SportCollector, ref: unknown): string | null {
  const d = obj(ref);
  const pid = id(d.id);
  const name = str(d.name);
  if (!pid || !name) return null;
  return c.participant({
    id: `${F1_DRIVER_PREFIX}${pid}`,
    kind: 'driver',
    name,
    shortName: null,
    code: str(d.abbr),
    countryName: null,
    countryCode: null,
    founded: null,
    venueId: null,
    logoUrl: media(d.image),
    logoKind: 'driver',
  });
}

function f1Team(c: SportCollector, ref: unknown): string | null {
  const t = obj(ref);
  const pid = id(t.id);
  const name = str(t.name);
  if (!pid || !name) return null;
  return c.participant({
    id: pid,
    kind: 'constructor',
    name,
    shortName: null,
    code: null,
    countryName: null,
    countryCode: null,
    founded: null,
    venueId: null,
    logoUrl: media(t.logo),
    // a equipe vem completa do /teams do catálogo: aqui só preenche lacunas
    reference: true,
  });
}

export function normalizeF1Races(items: unknown[], observedAt: Date): NormalizedBatch {
  const c = new SportCollector('formula-1', observedAt);
  const byId = new Map<string, NormalizedEvent>();
  for (const raw of items) {
    const r = obj(raw);
    const rid = id(r.id);
    const startsAt = instant(null, r.date);
    const year = int(r.season) ?? (startsAt ? startsAt.getUTCFullYear() : null);
    if (!rid || !startsAt || year == null) continue;
    const season = f1Season(c, year);
    // a API não tem datas de temporada: a janela sai do calendário (primeiro treino → última corrida)
    c.seasonDate(season, startsAt.toISOString().slice(0, 10));
    const gp = obj(r.competition);
    const gpId = id(gp.id);
    const gpName = str(gp.name);
    const location = obj(gp.location);
    const stageLabel =
      gpId && gpName
        ? c.stage(season, {
            label: `grand-prix-${gpId}`,
            kind: 'race_weekend',
            name: { 'pt-BR': gpName, es: gpName, en: gpName },
            order: 2000 + isoWeek(startsAt),
          })
        : null;
    const circuit = obj(r.circuit);
    const circuitId = id(circuit.id);
    const circuitName = str(circuit.name);
    const venueId =
      circuitId && circuitName
        ? c.venue({
            id: circuitId,
            name: circuitName,
            city: str(location.city),
            countryName: str(location.country),
            countryCode: null,
            capacity: null,
            surface: null,
            imageUrl: media(circuit.image),
            reference: true,
          })
        : null;
    const type = str(r.type);
    const statusText = str(r.status);
    const laps = obj(r.laps);
    const lap = int(laps.current);
    byId.set(rid, {
      id: rid,
      competitionId: season.competitionId,
      season,
      stageLabel,
      venueId,
      observation: {
        kind: 'valid',
        observedAt,
        status: mapSportStatus('formula-1', { long: statusText }),
        statusDetail: statusText,
        clock:
          lap != null ? { minute: null, extra: null, period: `L${lap}/${int(laps.total) ?? '?'}` } : null,
        score: null,
        startsAt,
        endsAtExpected: expectedEnd({ sport: 'formula-1', startsAt, durationMin: f1SessionMinutes(type) }),
      },
      // os pilotos chegam por rankings/races e rankings/startinggrid (complementos)
      participants: [],
      sportEvent: { providerEventId: rid, kind: 'race', summary: r, detail: null },
    });
  }
  c.batch.events = [...byId.values()];
  return c.done();
}

/** `rankings/races?race=` (resultado) e `rankings/startinggrid?race=` (grid) → pilotos do evento. */
export function normalizeF1RaceRanking(
  kind: 'results' | 'startinggrid',
  items: unknown[],
  observedAt: Date,
  params: Record<string, string> = {},
): NormalizedBatch {
  const c = new SportCollector('formula-1', observedAt);
  const byRace = new Map<string, Obj[]>();
  for (const raw of items) {
    const row = obj(raw);
    const raceId = id(obj(row.race).id) ?? id(params.race);
    const driverId = f1Driver(c, row.driver);
    if (!raceId || !driverId) continue;
    const teamId = f1Team(c, row.team);
    const team = teamId ? { id: int(obj(row.team).id), name: str(obj(row.team).name) } : null;
    const position = int(row.position);
    const result: Record<string, unknown> =
      kind === 'results'
        ? {
            position,
            time: str(row.time),
            laps: int(row.laps),
            grid: int(row.grid),
            pits: int(row.pits),
            gap: str(row.gap),
            team,
          }
        : { grid: position, qualifying_time: str(row.time), team };
    c.supplement(raceId).participants.push({
      participantId: driverId,
      side: 'grid',
      // no grid a posição é a de largada: não sobrescreve a classificação final
      position: kind === 'results' ? position : null,
      result,
    });
    byRace.set(raceId, [...(byRace.get(raceId) ?? []), row]);
  }
  for (const [raceId, rows] of byRace) c.supplement(raceId).detail = { [kind]: rows };
  return c.done();
}

/** `rankings/drivers?season` e `rankings/teams?season` → classificação do campeonato. */
export function normalizeF1Standings(
  kind: 'drivers' | 'constructors',
  items: unknown[],
  observedAt: Date,
  params: Record<string, string> = {},
): NormalizedBatch {
  const c = new SportCollector('formula-1', observedAt);
  for (const raw of items) {
    const row = obj(raw);
    const year = int(row.season) ?? seasonYear(params.season);
    const rank = int(row.position);
    const participantId = kind === 'drivers' ? f1Driver(c, row.driver) : f1Team(c, row.team);
    if (year == null || rank == null || !participantId) continue;
    if (kind === 'drivers') f1Team(c, row.team);
    const wins = int(row.wins) ?? 0;
    c.batch.standings.push({
      season: f1Season(c, year),
      group: kind,
      participantId,
      rank,
      // pontos podem ser fracionados (meia pontuação): arredondados; o valor exato fica no raw
      points: int(row.points) ?? 0,
      played: 0,
      won: wins,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      form: null,
      description: null,
    });
  }
  return c.done();
}

// ─── MMA ─────────────────────────────────────────────────────────────────────────────────────────

const MMA_WEIGHTS: Readonly<Record<string, { pt: string; es: string; order: number }>> = {
  strawweight: { pt: 'Peso-palha', es: 'Peso paja', order: 1 },
  flyweight: { pt: 'Peso-mosca', es: 'Peso mosca', order: 2 },
  bantamweight: { pt: 'Peso-galo', es: 'Peso gallo', order: 3 },
  featherweight: { pt: 'Peso-pena', es: 'Peso pluma', order: 4 },
  lightweight: { pt: 'Peso-leve', es: 'Peso ligero', order: 5 },
  welterweight: { pt: 'Peso-meio-médio', es: 'Peso wélter', order: 6 },
  middleweight: { pt: 'Peso-médio', es: 'Peso medio', order: 7 },
  'light heavyweight': { pt: 'Peso-meio-pesado', es: 'Peso semipesado', order: 8 },
  heavyweight: { pt: 'Peso-pesado', es: 'Peso pesado', order: 9 },
  'super heavyweight': { pt: 'Peso-superpesado', es: 'Peso superpesado', order: 10 },
  'catch weight': { pt: 'Peso casado', es: 'Peso pactado', order: 11 },
  catchweight: { pt: 'Peso casado', es: 'Peso pactado', order: 11 },
  'open weight': { pt: 'Peso aberto', es: 'Peso abierto', order: 12 },
};

/** Categoria de peso → fase (`core.stage`) da temporada: "Women's Flyweight" → "Peso-mosca feminino". */
export function mmaCategoryStage(category: unknown): StageSpec | null {
  const raw = str(category);
  if (!raw) return null;
  const women = /^women'?s\s+/i.test(raw);
  const base = raw.replace(/^women'?s\s+/i, '').toLowerCase();
  const w = MMA_WEIGHTS[base];
  const pt = w ? `${w.pt}${women ? ' feminino' : ''}` : raw;
  const es = w ? `${w.es}${women ? ' femenino' : ''}` : raw;
  return {
    label: `category-${raw}`,
    kind: 'other',
    name: { 'pt-BR': pt, es, en: raw },
    order: 2000 + (w?.order ?? 50) + (women ? 20 : 0),
  };
}

/** Minutos por luta no bloco do card (3 rounds de 5 min + intervalos, apresentação e decisão). */
export const MMA_FIGHT_MIN = 30;
/** Luta principal: 5 rounds. */
export const MMA_MAIN_EVENT_EXTRA_MIN = 15;

export function normalizeMmaFights(
  items: unknown[],
  observedAt: Date,
  params: Record<string, string> = {},
): NormalizedBatch {
  const c = new SportCollector('mma', observedAt);
  const fights = items.map(obj);
  // As lutas de um card saem em blocos com o mesmo horário (preliminares, card principal): o fim previsto
  // de cada luta é o fim do bloco — nº de lutas × 30 min (+15 se o bloco tem a luta principal).
  const blocks = new Map<string, { count: number; main: boolean }>();
  const blockKey = (f: Obj) => `${str(f.slug) ?? ''}|${String(f.timestamp ?? f.date ?? '')}`;
  for (const f of fights) {
    const b = blocks.get(blockKey(f)) ?? { count: 0, main: false };
    b.count += 1;
    b.main ||= f.is_main === true;
    blocks.set(blockKey(f), b);
  }
  const byId = new Map<string, NormalizedEvent>();
  for (const f of fights) {
    const fid = id(f.id);
    const startsAt = instant(f.timestamp, f.date);
    if (!fid || !startsAt) continue;
    const year = seasonYear(params.season) ?? startsAt.getUTCFullYear();
    const season = c.competition({
      id: MMA_COMPETITION_ID,
      name: 'MMA',
      type: 'cup',
      countryName: 'World',
      year,
    });
    const stageLabel = c.stage(season, mmaCategoryStage(f.category));
    const status = obj(f.status);
    const statusInput = { short: str(status.short), long: str(status.long) };
    const mapped = mapSportStatus('mma', statusInput);
    const block = blocks.get(blockKey(f))!;
    const fighters = obj(f.fighters);
    const participants: NormalizedEventParticipant[] = [];
    for (const [side, key] of [
      ['corner_red', 'first'],
      ['corner_blue', 'second'],
    ] as const) {
      const ref = obj(fighters[key]);
      const pid = id(ref.id);
      const name = str(ref.name);
      if (!pid || !name) continue;
      c.participant({
        id: pid,
        kind: 'fighter',
        name,
        shortName: null,
        code: null,
        countryName: null,
        countryCode: null,
        founded: null,
        venueId: null,
        logoUrl: media(ref.logo),
        logoKind: 'fighter',
        reference: true,
      });
      participants.push({
        participantId: pid,
        side,
        position: null,
        result: { winner: typeof ref.winner === 'boolean' ? ref.winner : null },
      });
    }
    byId.set(fid, {
      id: fid,
      competitionId: season.competitionId,
      season,
      stageLabel,
      venueId: null,
      observation: {
        kind: 'valid',
        observedAt,
        status: mapped,
        statusDetail: sportStatusDetail(statusInput),
        clock: null,
        score: null,
        startsAt,
        endsAtExpected: expectedEnd({
          sport: 'mma',
          startsAt,
          durationMin: block.count * MMA_FIGHT_MIN + (block.main ? MMA_MAIN_EVENT_EXTRA_MIN : 0),
        }),
      },
      participants,
      sportEvent: { providerEventId: fid, kind: 'fight', summary: f, detail: null },
    });
  }
  c.batch.events = [...byId.values()];
  return c.done();
}

/** `fights/results` (por `id`, `ids` ou `date`) → desfecho (método, round, tempo) somado ao espelho da luta. */
export function normalizeMmaResults(items: unknown[], observedAt: Date): NormalizedBatch {
  const c = new SportCollector('mma', observedAt);
  for (const raw of items) {
    const row = obj(raw);
    const fid = id(obj(row.fight).id);
    if (fid) c.supplement(fid).detail = { result: row };
  }
  return c.done();
}

// ─── despacho por endpoint ───────────────────────────────────────────────────────────────────────

const GAME_SPORTS = ['/games', '/games/h2h', '/standings', '/teams'] as const;

/** Endpoints de cada API que viram core (o resto fica só no raw, para o espelho). */
export const NORMALIZABLE_SPORT_ENDPOINTS: Readonly<Record<ApiSportsOtherSport, readonly string[]>> = {
  afl: GAME_SPORTS,
  baseball: GAME_SPORTS,
  basketball: GAME_SPORTS,
  handball: GAME_SPORTS,
  hockey: GAME_SPORTS,
  rugby: GAME_SPORTS,
  volleyball: GAME_SPORTS,
  'american-football': GAME_SPORTS,
  nba: ['/games', '/standings', '/teams'],
  'formula-1': [
    '/races',
    '/rankings/races',
    '/rankings/startinggrid',
    '/rankings/drivers',
    '/rankings/teams',
  ],
  mma: ['/fights', '/fights/results'],
};

/**
 * Endpoints que só complementam eventos já conhecidos: o runner os processa depois dos que criam
 * os eventos, para que o complemento encontre o evento no `provider_map`.
 */
export const SPORT_SUPPLEMENT_ENDPOINTS: ReadonlySet<string> = new Set([
  '/rankings/races',
  '/rankings/startinggrid',
  '/fights/results',
]);

/**
 * Normaliza um envelope pelo esporte e endpoint de origem. Devolve `null` para endpoints que não alimentam
 * o core e o número de itens da resposta para distinguir vazio de cheio.
 */
export function normalizeSportEnvelope(
  sport: ApiSportsOtherSport,
  endpoint: string,
  envelope: { response: unknown },
  observedAt: Date,
  params: Record<string, string> = {},
): { batch: NormalizedBatch; items: number } | null {
  if (!NORMALIZABLE_SPORT_ENDPOINTS[sport].includes(endpoint)) return null;
  const response = Array.isArray(envelope.response) ? (envelope.response as unknown[]) : [];
  const items = response.length;
  switch (endpoint) {
    case '/games':
    case '/games/h2h':
      return { batch: normalizeSportGames(sport, response, observedAt), items };
    case '/teams':
      return { batch: normalizeSportTeams(sport, response, observedAt), items };
    case '/standings':
      return { batch: normalizeSportStandings(sport, response, observedAt, params), items };
    case '/races':
      return { batch: normalizeF1Races(response, observedAt), items };
    case '/rankings/races':
      return { batch: normalizeF1RaceRanking('results', response, observedAt, params), items };
    case '/rankings/startinggrid':
      return { batch: normalizeF1RaceRanking('startinggrid', response, observedAt, params), items };
    case '/rankings/drivers':
      return { batch: normalizeF1Standings('drivers', response, observedAt, params), items };
    case '/rankings/teams':
      return { batch: normalizeF1Standings('constructors', response, observedAt, params), items };
    case '/fights':
      return { batch: normalizeMmaFights(response, observedAt, params), items };
    case '/fights/results':
      return { batch: normalizeMmaResults(response, observedAt), items };
    default:
      return null;
  }
}
