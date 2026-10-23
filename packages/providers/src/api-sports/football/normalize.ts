/**
 * Normalização pura das respostas da api-sports football v3 → lote neutro (`NormalizedBatch`).
 * Sem banco e sem rede: entra o envelope, sai o que o core deve conter.
 */
import { expectedEnd } from '../../event/status.js';
import type { EventScore, ValidObservation } from '../../event/state-machine.js';
import {
  emptyBatch,
  type NormalizedBatch,
  type NormalizedCompetition,
  type NormalizedEvent,
  type NormalizedIncident,
  type NormalizedParticipant,
  type NormalizedPerson,
  type NormalizedVenue,
  type SeasonRef,
} from '../../model.js';
import { coachPersonId } from './person-ids.js';
import { parseRound } from './round.js';
import { EXTRA_TIME_CODES, mapFootballStatus } from './status.js';
import type {
  ApiCoachItem,
  ApiFixture,
  ApiFixtureEvent,
  ApiPersonRef,
  ApiPlayerItem,
  ApiScorePair,
  ApiSidelinedEntry,
  ApiSidelinedItem,
  ApiSquadItem,
  ApiStandingsItem,
  ApiTeamItem,
  ApiTeamRef,
  ApiTransferItem,
  ApiTrophy,
  ApiTrophyItem,
} from './types.js';

export const API_SPORTS_PROVIDER = 'api-sports';
const SPORT = 'football';

// ─── coletor com deduplicação ────────────────────────────────────────────────────────────────────

/**
 * Junta duas versões da mesma entidade: valores conhecidos da mais nova prevalecem e `null` não apaga —
 * exceto que uma simples referência nunca sobrescreve a versão completa (só preenche lacunas).
 */
export function mergeKnown<T extends { reference?: boolean }>(prev: T | undefined, next: T): T {
  if (!prev) return next;
  const [base, over] = next.reference && !prev.reference ? [next, prev] : [prev, next];
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) if (v != null) out[k] = v;
  out.reference = !!(prev.reference && next.reference);
  return out as T;
}

class Collector {
  readonly batch: NormalizedBatch;
  private readonly competitions = new Map<string, NormalizedCompetition>();
  private readonly venues = new Map<string, NormalizedVenue>();
  private readonly participants = new Map<string, NormalizedParticipant>();
  private readonly persons = new Map<string, NormalizedPerson>();
  private readonly stages = new Set<string>();

  constructor(observedAt: Date) {
    this.batch = emptyBatch(API_SPORTS_PROVIDER, SPORT, observedAt);
  }

  competition(league: {
    id: number;
    name: string;
    country: string | null;
    logo: string | null;
    season: number;
  }): SeasonRef {
    const id = String(league.id);
    const prev = this.competitions.get(id);
    const seasons = prev?.seasons ?? [];
    if (!seasons.some((s) => s.year === league.season))
      seasons.push({ year: league.season, label: null, startDate: null, endDate: null });
    this.competitions.set(id, {
      id,
      name: league.name,
      type: 'league',
      countryName: league.country,
      countryCode: null,
      logoUrl: league.logo ?? prev?.logoUrl ?? null,
      seasons,
    });
    return { competitionId: id, year: league.season };
  }

  stage(season: SeasonRef, label: string | null): string | null {
    if (!label) return null;
    const key = `${season.competitionId}|${season.year}|${label}`;
    if (!this.stages.has(key)) {
      this.stages.add(key);
      const r = parseRound(label);
      this.batch.stages.push({ season, providerLabel: label, kind: r.kind, name: r.name, order: r.order });
    }
    return label;
  }

  venue(v: NormalizedVenue): string {
    const prev = this.venues.get(v.id);
    const merged = mergeKnown(prev, v);
    // nome: o visto no jogo mais recente vence; nome sem data (/teams) só vale sem nenhum datado
    const dated = [prev, v].filter((x): x is NormalizedVenue => !!x?.nameSeenAt);
    if (dated.length) {
      const latest = dated.reduce((a, b) => (b.nameSeenAt! >= a.nameSeenAt! ? b : a));
      merged.name = latest.name;
      merged.nameSeenAt = latest.nameSeenAt!;
    }
    this.venues.set(v.id, merged);
    return v.id;
  }

  team(ref: ApiTeamRef | null | undefined): string | null {
    if (!ref || ref.id == null || !ref.name) return null;
    return this.participant({
      id: String(ref.id),
      kind: null,
      name: ref.name,
      shortName: null,
      code: null,
      countryName: null,
      countryCode: null,
      founded: null,
      venueId: null,
      logoUrl: ref.logo ?? null,
      reference: true,
    });
  }

  participant(p: NormalizedParticipant): string {
    this.participants.set(p.id, mergeKnown(this.participants.get(p.id), p));
    return p.id;
  }

  /** Pessoa citada (evento, escalação, elenco): só preenche lacunas do perfil completo. */
  person(ref: ApiPersonRef | null | undefined, kind: 'player' | 'coach'): string | null {
    if (!ref || ref.id == null || !ref.name) return null;
    return this.fullPerson({
      id: kind === 'coach' ? coachPersonId(ref.id) : String(ref.id),
      name: ref.name,
      firstName: null,
      lastName: null,
      birthDate: null,
      nationality: null,
      heightCm: null,
      weightKg: null,
      photoUrl: ref.photo ?? null,
      photoKind: kind,
      reference: true,
    });
  }

  fullPerson(p: NormalizedPerson): string {
    this.persons.set(p.id, mergeKnown(this.persons.get(p.id), p));
    return p.id;
  }

  done(): NormalizedBatch {
    this.batch.competitions = [...this.competitions.values()];
    this.batch.venues = [...this.venues.values()];
    this.batch.participants = [...this.participants.values()];
    this.batch.persons = [...this.persons.values()];
    return this.batch;
  }
}

// ─── utilidades ──────────────────────────────────────────────────────────────────────────────────

function pair(p: ApiScorePair | null | undefined): { home: number | null; away: number | null } | null {
  if (!p || (p.home == null && p.away == null)) return null;
  return { home: p.home, away: p.away };
}

/** "180 cm" → 180; "75 kg" → 75. */
export function parseMeasure(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * `YYYY-MM-DD` válido, ou `null`. A api-sports às vezes troca dia e mês nas datas de nascimento
 * (`1978-23-11`): com o mês acima de 12 e o dia até 12, a data é invertida. Fora isso, data
 * impossível vira `null`, porque derrubaria o lote inteiro no Postgres.
 */
export function isoDate(value: string | null | undefined): string | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!m) return null;
  const [, y, a, b] = m as unknown as [string, string, string, string];
  const valid = (month: string, day: string) => {
    const d = new Date(Date.UTC(Number(y), Number(month) - 1, Number(day)));
    return d.getUTCMonth() === Number(month) - 1 && d.getUTCDate() === Number(day);
  };
  if (valid(a, b)) return `${y}-${a}-${b}`;
  if (Number(a) > 12 && valid(b, a)) return `${y}-${b}-${a}`;
  return null;
}

export function incidentType(e: Pick<ApiFixtureEvent, 'type' | 'detail'>): string {
  const type = (e.type ?? '').toLowerCase();
  if (type === 'goal') {
    if (e.detail === 'Own Goal') return 'own_goal';
    if (e.detail === 'Missed Penalty') return 'penalty_missed';
    return 'goal';
  }
  if (type === 'card' || type === 'subst' || type === 'var') return type;
  return type || 'other';
}

// ─── partidas (fixtures, fixtures?id, fixtures?live, fixtures/headtohead) ───────────────────────

function fixtureObservation(f: ApiFixture, observedAt: Date): ValidObservation {
  const short = f.fixture.status.short;
  const startsAt = new Date(f.fixture.timestamp ? f.fixture.timestamp * 1000 : f.fixture.date);
  const first = f.fixture.periods?.first;
  const score: EventScore = {
    home: f.goals.home,
    away: f.goals.away,
    halftime: { home: f.score.halftime?.home ?? null, away: f.score.halftime?.away ?? null },
    extratime: pair(f.score.extratime),
    penalty: pair(f.score.penalty),
  };
  return {
    kind: 'valid',
    observedAt,
    status: mapFootballStatus(short),
    statusDetail: short ?? null,
    clock: { minute: f.fixture.status.elapsed, extra: f.fixture.status.extra ?? null, period: short ?? null },
    score,
    startsAt,
    endsAtExpected: expectedEnd({
      sport: SPORT,
      startsAt,
      actualStartAt: first ? new Date(first * 1000) : null,
      extraTime: EXTRA_TIME_CODES.has(short) || pair(f.score.extratime) != null,
    }),
  };
}

function fixtureIncidents(c: Collector, events: ApiFixtureEvent[]): NormalizedIncident[] {
  return events.map((e, i) => ({
    sequence: i,
    minute: e.time?.elapsed ?? null,
    extra: e.time?.extra ?? null,
    type: incidentType(e),
    detail: e.detail ?? null,
    participantId: c.team(e.team),
    personId: c.person(e.player, 'player'),
    assistPersonId: c.person(e.assist, 'player'),
    data: e as unknown as Record<string, unknown>,
  }));
}

function addFixture(c: Collector, f: ApiFixture, observedAt: Date): NormalizedEvent {
  const season = c.competition(f.league);
  const stageLabel = c.stage(season, f.league.round);
  const v = f.fixture.venue;
  const venueId =
    v?.id != null && v.id > 0 && v.name
      ? c.venue({
          id: String(v.id),
          name: v.name,
          city: v.city,
          countryName: null,
          countryCode: null,
          capacity: null,
          surface: null,
          imageUrl: null,
          nameSeenAt: new Date(f.fixture.timestamp ? f.fixture.timestamp * 1000 : f.fixture.date),
          reference: true,
        })
      : null;

  const participants: NormalizedEvent['participants'] = [];
  for (const side of ['home', 'away'] as const) {
    const id = c.team(f.teams[side]);
    if (id)
      participants.push({
        participantId: id,
        side,
        position: null,
        result: { winner: f.teams[side].winner ?? null, goals: f.goals[side] },
      });
  }

  // Detalhe: escalações e jogadores também geram pessoas (para ligar a timeline a person_id).
  for (const l of f.lineups ?? []) {
    c.person(l.coach, 'coach');
    for (const p of [...(l.startXI ?? []), ...(l.substitutes ?? [])]) c.person(p.player, 'player');
  }
  for (const t of f.players ?? []) for (const p of t.players) c.person(p.player, 'player');

  const detailParts = Object.fromEntries(
    (['events', 'lineups', 'statistics', 'players'] as const)
      .filter((k) => Array.isArray(f[k]))
      .map((k) => [k, f[k]]),
  );

  const event: NormalizedEvent = {
    id: String(f.fixture.id),
    competitionId: season.competitionId,
    season,
    stageLabel,
    venueId,
    observation: fixtureObservation(f, observedAt),
    participants,
    footballFixture: {
      providerFixtureId: f.fixture.id,
      round: f.league.round,
      referee: f.fixture.referee,
      summary: { fixture: f.fixture, league: f.league, teams: f.teams, goals: f.goals, score: f.score },
      detail: Object.keys(detailParts).length ? detailParts : null,
    },
  };
  if (Array.isArray(f.events)) event.incidents = fixtureIncidents(c, f.events);
  return event;
}

export function normalizeFixtures(items: ApiFixture[], observedAt: Date): NormalizedBatch {
  const c = new Collector(observedAt);
  const byId = new Map<string, NormalizedEvent>();
  for (const f of items) {
    if (f?.fixture?.id == null || !f.league) continue;
    const e = addFixture(c, f, observedAt);
    byId.set(e.id, e);
  }
  c.batch.events = [...byId.values()];
  return c.done();
}

// ─── times (teams?league&season, teams?country, teams?id) ───────────────────────────────────────

export function normalizeTeams(items: ApiTeamItem[], observedAt: Date): NormalizedBatch {
  const c = new Collector(observedAt);
  for (const { team, venue } of items) {
    if (team?.id == null || !team.name) continue;
    const venueId =
      venue?.id != null && venue.id > 0 && venue.name
        ? c.venue({
            id: String(venue.id),
            name: venue.name,
            city: venue.city,
            countryName: team.country,
            countryCode: null,
            capacity: venue.capacity,
            surface: venue.surface,
            imageUrl: venue.image,
          })
        : null;
    c.participant({
      id: String(team.id),
      kind: team.national ? 'national_team' : 'club',
      name: team.name,
      shortName: null,
      code: team.code,
      countryName: team.country,
      countryCode: null,
      founded: team.founded,
      venueId,
      logoUrl: team.logo,
    });
  }
  return c.done();
}

// ─── elencos e pessoas ───────────────────────────────────────────────────────────────────────────

/** players/squads?team=X: elenco atual (substitui o elenco atual do time). */
export function normalizeSquads(items: ApiSquadItem[], observedAt: Date): NormalizedBatch {
  const c = new Collector(observedAt);
  for (const item of items) {
    const teamId = c.team(item.team);
    if (!teamId) continue;
    c.batch.rosterSnapshots.push({ participantId: teamId, role: 'player' });
    for (const p of item.players ?? []) {
      const personId = c.person(p, 'player');
      if (!personId) continue;
      c.batch.rosters.push({
        participantId: teamId,
        personId,
        season: null,
        role: 'player',
        number: p.number,
        position: p.position,
        validFrom: null,
        validTo: null,
      });
    }
  }
  return c.done();
}

/** coachs?team=X: todos os técnicos que passaram pelo time; só o atual entra no elenco atual. */
export function normalizeCoaches(
  items: ApiCoachItem[],
  observedAt: Date,
  params: Record<string, string> = {},
): NormalizedBatch {
  const c = new Collector(observedAt);
  const requestedTeam = params.team;
  if (requestedTeam) c.batch.rosterSnapshots.push({ participantId: requestedTeam, role: 'coach' });
  for (const coach of items) {
    if (coach?.id == null || !coach.name) continue;
    const personId = c.fullPerson({
      id: coachPersonId(coach.id),
      name: coach.name,
      firstName: coach.firstname,
      lastName: coach.lastname,
      birthDate: isoDate(coach.birth?.date),
      nationality: coach.nationality,
      heightCm: parseMeasure(coach.height),
      weightKg: parseMeasure(coach.weight),
      photoUrl: coach.photo,
      photoKind: 'coach',
    });
    const currentTeam = coach.team?.id != null ? String(coach.team.id) : null;
    const current = (coach.career ?? []).find(
      (s) => s.end == null && s.team?.id != null && String(s.team.id) === currentTeam,
    );
    if (!currentTeam || !current || (requestedTeam && requestedTeam !== currentTeam)) continue;
    const teamId = c.team({ ...current.team, name: current.team.name ?? coach.team?.name ?? null });
    if (!teamId) continue;
    c.batch.rosters.push({
      participantId: teamId,
      personId,
      season: null,
      role: 'coach',
      number: null,
      position: null,
      validFrom: isoDate(current.start),
      validTo: null,
    });
  }
  return c.done();
}

/** players?team&season / players?id&season / players?league&season: perfis + elenco por temporada. */
export function normalizePlayers(items: ApiPlayerItem[], observedAt: Date): NormalizedBatch {
  const c = new Collector(observedAt);
  const seen = new Set<string>();
  for (const { player, statistics } of items) {
    if (player?.id == null || !player.name) continue;
    const personId = c.fullPerson({
      id: String(player.id),
      name: player.name,
      firstName: player.firstname,
      lastName: player.lastname,
      birthDate: isoDate(player.birth?.date),
      nationality: player.nationality,
      heightCm: parseMeasure(player.height),
      weightKg: parseMeasure(player.weight),
      birthPlace: player.birth?.place ?? null,
      birthCountry: player.birth?.country ?? null,
      photoUrl: player.photo,
      photoKind: 'player',
    });
    for (const s of statistics ?? []) {
      const teamId = c.team(s.team);
      if (!teamId || s.league?.id == null || s.league.season == null) continue;
      const key = `${teamId}|${personId}|${s.league.id}|${s.league.season}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const season = c.competition({
        id: s.league.id,
        name: s.league.name ?? String(s.league.id),
        country: s.league.country ?? null,
        logo: s.league.logo ?? null,
        season: s.league.season,
      });
      c.batch.rosters.push({
        participantId: teamId,
        personId,
        season,
        role: 'player',
        number: s.games?.number ?? null,
        position: s.games?.position ?? null,
        validFrom: null,
        validTo: null,
      });
      const { team: _team, league: _league, ...stats } = s;
      const rating = s.games?.rating != null ? Number(s.games.rating) : NaN;
      c.batch.personSeasonStats.push({
        personId,
        participantId: teamId,
        season,
        position: s.games?.position ?? null,
        number: s.games?.number ?? null,
        captain: s.games?.captain ?? null,
        appearances: s.games?.appearences ?? null,
        lineups: s.games?.lineups ?? null,
        minutes: s.games?.minutes ?? null,
        rating: Number.isFinite(rating) ? Math.round(rating * 100) / 100 : null,
        goals: s.goals?.total ?? null,
        assists: s.goals?.assists ?? null,
        conceded: s.goals?.conceded ?? null,
        saves: s.goals?.saves ?? null,
        yellowCards: s.cards?.yellow ?? null,
        redCards: s.cards?.red ?? null,
        stats,
      });
    }
  }
  return c.done();
}

/** transfers?team / transfers?player: histórico de transferências; times desconhecidos entram como referência. */
export function normalizeTransfers(items: ApiTransferItem[], observedAt: Date): NormalizedBatch {
  const c = new Collector(observedAt);
  const seen = new Set<string>();
  for (const item of items) {
    const personId = c.person(item.player, 'player');
    if (!personId) continue;
    for (const t of item.transfers ?? []) {
      const fromParticipantId = c.team(t.teams?.out);
      const toParticipantId = c.team(t.teams?.in);
      const date = isoDate(t.date);
      const key = [personId, date, fromParticipantId, toParticipantId, t.type].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      c.batch.transfers.push({
        personId,
        date,
        type: t.type ?? null,
        fromParticipantId,
        toParticipantId,
        fromName: t.teams?.out?.name ?? null,
        toName: t.teams?.in?.name ?? null,
      });
    }
  }
  return c.done();
}

/**
 * Lista por pessoa de trophies/sidelined: `players=a-b` (ou `coachs=a-b`) traz `{ id, <campo> }` por pessoa e
 * `player=a` (ou `coach=a`) traz a lista direto. Os técnicos levam o prefixo de `coachPersonId`.
 */
function perPerson<T>(items: unknown[], field: string, params: Record<string, string>): [string, T[]][] {
  const coach = !!(params.coach || params.coachs);
  const personId = (id: string | number) => (coach ? coachPersonId(id) : String(id));
  const out: [string, T[]][] = [];
  const flat: T[] = [];
  for (const it of items as Record<string, unknown>[]) {
    if (it && typeof it.id === 'number' && Array.isArray(it[field]))
      out.push([personId(it.id), it[field] as T[]]);
    else flat.push(it as T);
  }
  const single = params.coach ?? params.player;
  if (flat.length && single) out.push([personId(single), flat]);
  return out;
}

/** trophies?players / trophies?player: títulos de jogadores já conhecidos. */
export function normalizeTrophies(
  items: ApiTrophyItem[],
  observedAt: Date,
  params: Record<string, string> = {},
): NormalizedBatch {
  const c = new Collector(observedAt);
  const seen = new Set<string>();
  for (const [personId, trophies] of perPerson<ApiTrophy>(items, 'trophies', params)) {
    for (const t of trophies) {
      if (!t?.league) continue;
      const row = {
        personId,
        league: t.league,
        country: t.country ?? null,
        season: t.season ?? null,
        place: t.place ?? null,
      };
      const key = [row.personId, row.league, row.country, row.season, row.place].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      c.batch.trophies.push(row);
    }
  }
  return c.done();
}

/** sidelined?players / sidelined?player: afastamentos de jogadores já conhecidos. */
export function normalizeSidelined(
  items: ApiSidelinedItem[],
  observedAt: Date,
  params: Record<string, string> = {},
): NormalizedBatch {
  const c = new Collector(observedAt);
  const seen = new Set<string>();
  for (const [personId, entries] of perPerson<ApiSidelinedEntry>(items, 'sidelined', params)) {
    for (const e of entries) {
      if (!e?.type) continue;
      const row = { personId, type: e.type, startDate: isoDate(e.start), endDate: isoDate(e.end) };
      const key = [row.personId, row.type, row.startDate].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      c.batch.sidelined.push(row);
    }
  }
  return c.done();
}

// ─── classificação ───────────────────────────────────────────────────────────────────────────────

export function normalizeStandings(items: ApiStandingsItem[], observedAt: Date): NormalizedBatch {
  const c = new Collector(observedAt);
  for (const { league } of items) {
    if (league?.id == null) continue;
    const season = c.competition(league);
    for (const group of league.standings ?? []) {
      for (const row of group) {
        const participantId = c.team(row.team);
        if (!participantId) continue;
        c.batch.standings.push({
          season,
          group: row.group ?? '',
          participantId,
          rank: row.rank,
          points: row.points,
          played: row.all?.played ?? 0,
          won: row.all?.win ?? 0,
          drawn: row.all?.draw ?? 0,
          lost: row.all?.lose ?? 0,
          goalsFor: row.all?.goals?.for ?? 0,
          goalsAgainst: row.all?.goals?.against ?? 0,
          form: row.form,
          description: row.description,
        });
      }
    }
  }
  return c.done();
}

// ─── catálogo (leagues) ──────────────────────────────────────────────────────────────────────────

export interface ApiLeagueItem {
  league: { id: number; name: string; type: string; logo: string | null };
  country: { name: string; code: string | null; flag: string | null };
  seasons: { year: number; start: string | null; end: string | null }[];
}

/** /leagues → competições e temporadas (o bootstrap do catálogo continua dono do tier e do slug). */
export function normalizeLeagues(items: ApiLeagueItem[], observedAt: Date): NormalizedBatch {
  const batch = emptyBatch(API_SPORTS_PROVIDER, SPORT, observedAt);
  for (const { league, country, seasons } of items) {
    if (league?.id == null) continue;
    batch.competitions.push({
      id: String(league.id),
      name: league.name,
      type: league.type?.toLowerCase() === 'cup' ? 'cup' : 'league',
      countryName: country?.name ?? null,
      countryCode: country?.code ? country.code.toUpperCase() : null,
      logoUrl: league.logo,
      seasons: (seasons ?? []).map((s) => ({
        year: s.year,
        label: null,
        startDate: isoDate(s.start),
        endDate: isoDate(s.end),
      })),
    });
  }
  return batch;
}

// ─── despacho por endpoint ───────────────────────────────────────────────────────────────────────

/** Endpoints da api-sports football que viram core. */
export const NORMALIZABLE_FOOTBALL_ENDPOINTS = [
  '/fixtures',
  '/fixtures/headtohead',
  '/teams',
  '/players/squads',
  '/coachs',
  '/players',
  '/standings',
  '/transfers',
  '/trophies',
  '/sidelined',
] as const;

export interface EnvelopeLike {
  response: unknown;
  parameters?: unknown;
}

/**
 * Normaliza um envelope pelo endpoint de origem. Devolve `null` para endpoints que não alimentam
 * o core (ex.: /odds, /injuries) e o número de itens da resposta para distinguir vazio de cheio.
 */
export function normalizeFootballEnvelope(
  endpoint: string,
  envelope: EnvelopeLike,
  observedAt: Date,
  params: Record<string, string> = {},
): { batch: NormalizedBatch; items: number } | null {
  const response = Array.isArray(envelope.response) ? envelope.response : [];
  const items = response.length;
  switch (endpoint) {
    case '/fixtures':
    case '/fixtures/headtohead':
      return { batch: normalizeFixtures(response as ApiFixture[], observedAt), items };
    case '/teams':
      return { batch: normalizeTeams(response as ApiTeamItem[], observedAt), items };
    case '/players/squads':
      return { batch: normalizeSquads(response as ApiSquadItem[], observedAt), items };
    case '/coachs':
      return { batch: normalizeCoaches(response as ApiCoachItem[], observedAt, params), items };
    case '/players':
      return { batch: normalizePlayers(response as ApiPlayerItem[], observedAt), items };
    case '/standings':
      return { batch: normalizeStandings(response as ApiStandingsItem[], observedAt), items };
    case '/transfers':
      return { batch: normalizeTransfers(response as ApiTransferItem[], observedAt), items };
    case '/trophies':
      return { batch: normalizeTrophies(response as ApiTrophyItem[], observedAt, params), items };
    case '/sidelined':
      return { batch: normalizeSidelined(response as ApiSidelinedItem[], observedAt, params), items };
    default:
      return null;
  }
}
