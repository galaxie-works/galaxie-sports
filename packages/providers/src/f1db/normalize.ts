/**
 * F1DB (release SQLite, CC BY 4.0) → lote neutro (`NormalizedBatch`), segunda fonte da Fórmula 1.
 *
 * Mesmo modelo da F1 da api-sports, para a API servir o histórico sem mudar o contrato:
 * - o campeonato é a competição sintética `world-championship` (uma temporada por ano, 1950 em diante);
 * - cada GP vira `core.stage` (`race_weekend`) e cada sessão com resultado (TL1–4, classificação, classificação da
 *   sprint, sprint, corrida) vira evento, com os pilotos no lado `grid` (`position` e `result` no formato da
 *   api-sports: tempo, diferença, voltas, largada, paradas e equipe);
 * - o espelho (`core.sport_event_detail`, provider `f1db`) traz o resumo no formato que a API já lê (`type`,
 *   `laps.total`, `distance`, `fastest_lap`) e, na corrida, grid de largada, pit stops e voltas mais rápidas;
 * - pilotos (`driver-<id>`), construtores e circuitos viram participantes e locais; os casados com a outra
 *   fonte entram como referência (só preenchem lacunas: a api-sports continua dona de nome e imagens);
 * - classificação final de pilotos e construtores de cada temporada → `core.standing`.
 *
 * GPs cobertos pela outra fonte (`links.coveredRaces`) não geram sessões; sessões sem resultado (calendário
 * futuro) também não.
 */
import { expectedEnd } from '../event/status.js';
import { f1SessionMinutes, F1_COMPETITION_ID } from '../api-sports/sports/normalize.js';
import {
  emptyBatch,
  type NormalizedBatch,
  type NormalizedCompetition,
  type NormalizedEvent,
  type NormalizedEventParticipant,
  type NormalizedParticipant,
  type NormalizedVenue,
  type SeasonRef,
} from '../model.js';
import { sessionStart } from './schedule.js';
import {
  F1DB_LICENSE,
  F1DB_PROVIDER,
  F1DB_SESSION_TYPES,
  F1DB_SPORT,
  f1dbDriverId,
  f1dbEventId,
  groupBy,
  int,
  num,
  rowsOf,
  str,
  type F1dbRow,
  type F1dbSessionDataType,
  type F1dbTables,
} from './tables.js';

export interface F1dbNormalizeContext {
  observedAt: Date;
  /** Versão do release (ex.: `v2026.17.0`), gravada no espelho. */
  release: string;
  /** Corridas cujo GP já veio da outra fonte. */
  coveredRaces?: ReadonlySet<string>;
  /** Rótulo da fase (GP) da outra fonte por `grand_prix_id`. */
  stageLabels?: ReadonlyMap<string, string>;
  /** IDs do F1DB já casados com entidades da outra fonte (entram como referência). */
  matchedParticipants?: ReadonlySet<string>;
  matchedVenues?: ReadonlySet<string>;
}

/** Posições sem corrida (não se classificou, não pré-classificou): ficam fora da sessão. */
const NOT_IN_SESSION = new Set(['DNQ', 'DNPQ']);
/** Sem posição numérica, mas largou: entram na ordem da classificação (como a api-sports). */
const RETIRED = new Set(['DNF', 'NC', 'DSQ', 'EX']);

/** Semana ISO (1–53): mesma ordem de GPs da api-sports (`2000 + semana`). */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

const km = (v: unknown) => {
  const n = num(v);
  return n == null ? null : `${n} km`;
};

/** Linha do F1DB sem as colunas nulas e sem o que a sessão já diz (vai para o espelho). */
function compact(row: F1dbRow, drop: string[] = []): F1dbRow {
  const out: F1dbRow = {};
  for (const [k, v] of Object.entries(row))
    if (v != null && !drop.includes(k)) out[k] = typeof v === 'bigint' ? Number(v) : v;
  return out;
}

/** Idiomas dos nomes de país criados a partir do F1DB (os da API). */
const COUNTRY_LOCALES = ['en', 'pt-BR', 'es'] as const;

/**
 * Países dos pilotos, construtores e circuitos do F1DB (ISO 3166-1 alpha-2), com o nome em cada idioma da API
 * (`Intl.DisplayNames`; sem tradução, o nome do F1DB). O core só conhece os países dos catálogos da api-sports e da
 * FIFA: sem a linha, o upsert descarta o código e o piloto fica sem país (Mônaco não é membro da FIFA, e Leclerc
 * ficava sem bandeira). O import só cria os que faltam: nome curado nunca é trocado.
 */
export function f1dbCountries(tables: F1dbTables): { code: string; name: Record<string, string> }[] {
  const used = new Set(
    [...rowsOf(tables, 'driver'), ...rowsOf(tables, 'constructor'), ...rowsOf(tables, 'circuit')].flatMap(
      (r) =>
        [
          r.nationality_country_id,
          r.second_nationality_country_id,
          r.country_of_birth_country_id,
          r.country_id,
        ]
          .map(str)
          .filter((id): id is string => !!id),
    ),
  );
  const out: { code: string; name: Record<string, string> }[] = [];
  for (const c of rowsOf(tables, 'country')) {
    const code = str(c.alpha2_code)?.toUpperCase();
    const fallback = str(c.name);
    if (!code || !/^[A-Z]{2}$/.test(code) || !fallback || !used.has(str(c.id)!)) continue;
    const name: Record<string, string> = {};
    for (const locale of COUNTRY_LOCALES) {
      let label: string | undefined;
      try {
        label = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(code);
      } catch {
        label = undefined;
      }
      name[locale] = label ?? fallback;
    }
    out.push({ code, name });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

export function normalizeF1db(tables: F1dbTables, ctx: F1dbNormalizeContext): NormalizedBatch {
  const batch = emptyBatch(F1DB_PROVIDER, F1DB_SPORT, ctx.observedAt);
  const covered = ctx.coveredRaces ?? new Set<string>();
  const matchedParticipants = ctx.matchedParticipants ?? new Set<string>();
  const matchedVenues = ctx.matchedVenues ?? new Set<string>();

  const alpha2 = new Map(rowsOf(tables, 'country').map((c) => [str(c.id), str(c.alpha2_code)]));
  const countryName = new Map(rowsOf(tables, 'country').map((c) => [str(c.id), str(c.name)]));
  const gps = new Map(rowsOf(tables, 'grand_prix').map((g) => [str(g.id), g]));
  const circuits = new Map(rowsOf(tables, 'circuit').map((c) => [str(c.id), c]));
  const drivers = new Map(rowsOf(tables, 'driver').map((d) => [str(d.id), d]));
  const constructors = new Map(rowsOf(tables, 'constructor').map((c) => [str(c.id), c]));
  const raceData = groupBy(rowsOf(tables, 'race_data'), (r) => str(r.race_id));

  // ─ entidades citadas (criadas sob demanda, uma vez) ─
  const participants = new Map<string, NormalizedParticipant>();
  const driverRef = (driverId: string | null): string | null => {
    const d = driverId ? drivers.get(driverId) : undefined;
    if (!driverId || !d) return null;
    const pid = f1dbDriverId(driverId);
    if (!participants.has(pid))
      participants.set(pid, {
        id: pid,
        kind: 'driver',
        name: str(d.name) ?? driverId,
        shortName: str(d.last_name),
        code: str(d.abbreviation),
        countryName: countryName.get(str(d.nationality_country_id)) ?? null,
        countryCode: alpha2.get(str(d.nationality_country_id)) ?? null,
        founded: null,
        venueId: null,
        logoUrl: null,
        logoKind: 'driver',
        birthDate: str(d.date_of_birth),
        birthPlace: str(d.place_of_birth),
        birthCountryName: countryName.get(str(d.country_of_birth_country_id)) ?? null,
        birthCountryCode: alpha2.get(str(d.country_of_birth_country_id)) ?? null,
        number: int(d.permanent_number),
        reference: matchedParticipants.has(pid),
      });
    return pid;
  };
  const constructorRef = (constructorId: string | null): { id: string; name: string } | null => {
    const c = constructorId ? constructors.get(constructorId) : undefined;
    if (!constructorId || !c) return null;
    const name = str(c.name) ?? constructorId;
    if (!participants.has(constructorId))
      participants.set(constructorId, {
        id: constructorId,
        kind: 'constructor',
        name,
        shortName: null,
        code: null,
        countryName: countryName.get(str(c.country_id)) ?? null,
        countryCode: alpha2.get(str(c.country_id)) ?? null,
        founded: null,
        venueId: null,
        logoUrl: null,
        reference: matchedParticipants.has(constructorId),
      });
    return { id: constructorId, name };
  };
  const venues = new Map<string, NormalizedVenue>();
  const venueRef = (circuitId: string | null): string | null => {
    const c = circuitId ? circuits.get(circuitId) : undefined;
    if (!circuitId || !c) return null;
    if (!venues.has(circuitId))
      venues.set(circuitId, {
        id: circuitId,
        name: str(c.full_name) ?? str(c.name) ?? circuitId,
        city: str(c.place_name),
        countryName: countryName.get(str(c.country_id)) ?? null,
        countryCode: alpha2.get(str(c.country_id)) ?? null,
        capacity: null,
        surface: null,
        imageUrl: null,
        reference: matchedVenues.has(circuitId),
      });
    return circuitId;
  };

  // ─ competição e temporadas ─
  const seasons = new Map<
    number,
    { year: number; label: string; startDate: string | null; endDate: string | null }
  >();
  const seasonRef = (year: number): SeasonRef => {
    if (!seasons.has(year)) seasons.set(year, { year, label: String(year), startDate: null, endDate: null });
    return { competitionId: F1_COMPETITION_ID, year };
  };
  const seasonDay = (year: number, day: string) => {
    const s = seasons.get(year)!;
    if (!s.startDate || day < s.startDate) s.startDate = day;
    if (!s.endDate || day > s.endDate) s.endDate = day;
  };

  // ─ GPs e sessões ─
  const events: NormalizedEvent[] = [];
  for (const race of rowsOf(tables, 'race')) {
    const raceId = str(race.id);
    const year = int(race.year);
    if (!raceId || year == null || covered.has(raceId)) continue;
    const rows = raceData.get(raceId) ?? [];
    const byType = groupBy(rows, (r) => str(r.type));
    if (!byType.has('RACE_RESULT')) continue;

    const season = seasonRef(year);
    const gpId = str(race.grand_prix_id);
    const gp = gpId ? gps.get(gpId) : undefined;
    const gpName = str(gp?.full_name) ?? str(race.official_name) ?? `Grand Prix ${year}/${str(race.round)}`;
    const circuitId = str(race.circuit_id);
    const venueId = venueRef(circuitId);
    const longitude = num(circuitId ? circuits.get(circuitId)?.longitude : null);
    const sprintWeekend = byType.has('SPRINT_RACE_RESULT');
    const raceStart = sessionStart(race, 'race', { sprintWeekend, longitude });
    if (!raceStart) continue;
    const stageLabel = (gpId && ctx.stageLabels?.get(gpId)) ?? `gp-${gpId ?? raceId}`;
    batch.stages.push({
      season,
      providerLabel: stageLabel,
      kind: 'race_weekend',
      name: { 'pt-BR': gpName, es: gpName, en: gpName },
      order: 2000 + isoWeek(raceStart.startsAt),
    });

    const fastest = (byType.get('FASTEST_LAP') ?? []).find((r) => int(r.position_number) === 1);
    // paradas por piloto: o resultado nem sempre traz o total (temporadas antigas)
    const stops = new Map<string, number>();
    for (const r of byType.get('PIT_STOP') ?? []) {
      const d = str(r.driver_id);
      if (d) stops.set(d, Math.max(stops.get(d) ?? 0, int(r.pit_stop_stop) ?? 0));
    }
    for (const [type, session] of Object.entries(F1DB_SESSION_TYPES) as [
      F1dbSessionDataType,
      (typeof F1DB_SESSION_TYPES)[F1dbSessionDataType],
    ][]) {
      const sessionRows = byType.get(type);
      if (!sessionRows?.length) continue;
      const start =
        session.key === 'race' ? raceStart : sessionStart(race, session.key, { sprintWeekend, longitude });
      if (!start) continue;
      seasonDay(year, start.startsAt.toISOString().slice(0, 10));
      const isRace = session.key === 'race' || session.key === 'sprint';
      const ordered = [...sessionRows].sort(
        (a, b) => (int(a.position_display_order) ?? 999) - (int(b.position_display_order) ?? 999),
      );
      const eps: NormalizedEventParticipant[] = [];
      // carro compartilhado (anos 1950): o piloto aparece mais de uma vez na mesma sessão; vale a melhor linha (a
      // primeira na ordem da classificação), como na contagem do F1DB: a vitória de Fangio no GP da França de 1951,
      // no carro de Fagioli, não pode ser trocada pelo abandono no carro dele
      // (a pole fica com o piloto mesmo que ela esteja na linha do outro carro)
      const placed = new Map<string, NormalizedEventParticipant>();
      for (const row of ordered) {
        const text = str(row.position_text);
        if (text && NOT_IN_SESSION.has(text)) continue;
        const pid = driverRef(str(row.driver_id));
        if (!pid) continue;
        const first = placed.get(pid);
        if (first) {
          if (type === 'RACE_RESULT' && Number(row.race_pole_position) === 1 && first.result)
            first.result.pole = true;
          continue;
        }
        const team = constructorRef(str(row.constructor_id));
        const number = int(row.position_number);
        const position =
          number ?? (isRace && text && RETIRED.has(text) ? int(row.position_display_order) : null);
        const result = sessionResult(type, row, team);
        if (session.key === 'race' && result.pits == null)
          result.pits = stops.get(str(row.driver_id)!) ?? null;
        const ep: NormalizedEventParticipant = { participantId: pid, side: 'grid', position, result };
        placed.set(pid, ep);
        eps.push(ep);
      }
      if (!eps.length) continue;

      const laps =
        session.key === 'race'
          ? int(race.laps)
          : session.key === 'sprint'
            ? int(race.sprint_race_laps)
            : null;
      const distance =
        session.key === 'race'
          ? km(race.distance)
          : session.key === 'sprint'
            ? km(race.sprint_race_distance)
            : null;
      const summary: Record<string, unknown> = {
        source: F1DB_PROVIDER,
        license: F1DB_LICENSE,
        release: ctx.release,
        race_id: int(race.id),
        season: year,
        round: int(race.round),
        type: session.label,
        date: start.startsAt.toISOString(),
        time_estimated: start.estimated,
        status: 'Completed',
        grand_prix: { id: gpId, name: gpName },
        official_name: str(race.official_name),
        circuit: { id: circuitId, name: venueId ? venues.get(venueId)!.name : null },
        laps: { total: laps, current: null },
        distance,
        fastest_lap:
          session.key === 'race' && fastest
            ? { driver: { id: str(fastest.driver_id) }, time: str(fastest.fastest_lap_time) }
            : null,
      };
      const detail =
        session.key === 'race'
          ? {
              starting_grid: (byType.get('STARTING_GRID_POSITION') ?? []).map((r) =>
                compact(r, ['race_id', 'type']),
              ),
              pit_stops: (byType.get('PIT_STOP') ?? []).map((r) => compact(r, ['race_id', 'type'])),
              fastest_laps: (byType.get('FASTEST_LAP') ?? []).map((r) => compact(r, ['race_id', 'type'])),
            }
          : session.key === 'sprint'
            ? {
                starting_grid: (byType.get('SPRINT_STARTING_GRID_POSITION') ?? []).map((r) =>
                  compact(r, ['race_id', 'type']),
                ),
              }
            : null;
      const id = f1dbEventId(raceId, session.key);
      events.push({
        id,
        competitionId: F1_COMPETITION_ID,
        season,
        stageLabel,
        venueId,
        observation: {
          kind: 'valid',
          observedAt: ctx.observedAt,
          status: 'finished',
          statusDetail: 'Completed',
          clock: null,
          score: null,
          startsAt: start.startsAt,
          endsAtExpected: expectedEnd({
            sport: F1DB_SPORT,
            startsAt: start.startsAt,
            durationMin: f1SessionMinutes(session.label),
          }),
        },
        participants: eps,
        sportEvent: { providerEventId: id, kind: 'race', summary, detail },
      });
    }
  }

  // ─ calendário: a temporada vai até o último GP previsto, não só até o último disputado (com o release no meio do
  //   ano, a liderança não é título) ─
  for (const race of rowsOf(tables, 'race')) {
    const year = int(race.year);
    const day = str(race.date);
    if (year != null && day && seasons.has(year)) seasonDay(year, day);
  }

  // ─ campeonatos (classificação final de cada temporada) ─
  const driverSeason = new Map(
    rowsOf(tables, 'season_driver').map((r) => [`${str(r.year)}|${str(r.driver_id)}`, r]),
  );
  const constructorSeason = new Map(
    rowsOf(tables, 'season_constructor').map((r) => [`${str(r.year)}|${str(r.constructor_id)}`, r]),
  );
  const standing = (
    group: 'drivers' | 'constructors',
    row: F1dbRow,
    participantId: string | null,
    stats: F1dbRow | undefined,
  ) => {
    const year = int(row.year);
    const rank = int(row.position_number) ?? int(row.position_display_order);
    if (year == null || rank == null || !participantId) return;
    batch.standings.push({
      season: seasonRef(year),
      group,
      participantId,
      rank,
      // pontos podem ser fracionados (meia pontuação): arredondados, como na api-sports
      points: int(row.points) ?? 0,
      played: int(stats?.total_race_starts) ?? 0,
      won: int(stats?.total_race_wins) ?? 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      form: null,
      description: null,
    });
  };
  for (const row of rowsOf(tables, 'season_driver_standing'))
    standing(
      'drivers',
      row,
      driverRef(str(row.driver_id)),
      driverSeason.get(`${str(row.year)}|${str(row.driver_id)}`),
    );
  for (const row of rowsOf(tables, 'season_constructor_standing'))
    standing(
      'constructors',
      row,
      constructorRef(str(row.constructor_id))?.id ?? null,
      constructorSeason.get(`${str(row.year)}|${str(row.constructor_id)}`),
    );

  const competition: NormalizedCompetition = {
    id: F1_COMPETITION_ID,
    name: 'Formula 1 World Championship',
    type: 'league',
    countryName: 'World',
    countryCode: null,
    logoUrl: null,
    seasons: [...seasons.values()].sort((a, b) => a.year - b.year),
  };
  batch.competitions = [competition];
  batch.venues = [...venues.values()];
  batch.participants = [...participants.values()];
  batch.events = events;
  return batch;
}

/** Resultado do piloto na sessão, no formato que a API já lê para a F1 (`raceResult`). */
function sessionResult(
  type: F1dbSessionDataType,
  row: F1dbRow,
  team: { id: string; name: string } | null,
): Record<string, unknown> {
  const text = str(row.position_text);
  const common = { position_text: text, number: int(row.driver_number), team };
  if (type === 'RACE_RESULT' || type === 'SPRINT_RACE_RESULT') {
    const retired = text != null && RETIRED.has(text);
    return {
      ...common,
      // retardatário: "+1 lap" no lugar do tempo; abandono: "DNF"
      time: str(row.race_time) ?? (retired ? text : str(row.race_gap)),
      gap: str(row.race_gap),
      laps: int(row.race_laps),
      grid: int(row.race_grid_position_number),
      // a pole do F1DB: quem largou nela (punição de grid desconta), não só o 1º da classificação
      ...(type === 'RACE_RESULT' && row.race_pole_position != null
        ? { pole: Number(row.race_pole_position) === 1 || row.race_pole_position === true }
        : {}),
      pits: int(row.race_pit_stops),
      points: num(row.race_points),
      status: str(row.race_reason_retired),
    };
  }
  if (type === 'QUALIFYING_RESULT' || type === 'SPRINT_QUALIFYING_RESULT') {
    const q1 = str(row.qualifying_q1);
    const q2 = str(row.qualifying_q2);
    const q3 = str(row.qualifying_q3);
    return {
      ...common,
      time: q3 ?? q2 ?? q1 ?? str(row.qualifying_time),
      gap: str(row.qualifying_gap),
      laps: int(row.qualifying_laps),
      q1,
      q2,
      q3,
    };
  }
  return {
    ...common,
    time: str(row.practice_time),
    gap: str(row.practice_gap),
    laps: int(row.practice_laps),
  };
}
