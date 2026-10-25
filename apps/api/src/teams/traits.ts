/**
 * Traços do piloto de F1, calculados do core (F1DB + api-sports), sem IA. Critérios (também em
 * docs/runbooks/f1-perfil-editorial.md):
 *
 * - Corrida = sessão `Race` (sprint fora); pole = 1º na classificação do GP (`Qualifying` do F1DB ou `3rd
 *   Qualifying` da api-sports), como na carreira; chegada conta só com bandeirada (posição numérica).
 * - Pistas preferidas: por circuito (o local do evento), vitórias, pódios, poles e chegada média; as 3 melhores na
 *   ordem vitórias → pódios → poles → chegada média, com pelo menos `FAVORITE_MIN_RACES` largadas no circuito.
 * - Sábado × domingo: taxa de pole, largada média, chegada média e posições ganhas (largada − chegada, só corridas
 *   com as duas). O rótulo compara o piloto ao companheiro de equipe, que tem o mesmo carro: quem vence o duelo de
 *   grid bem mais do que o de corrida é "de classificação"; o contrário, "de corrida" (`QUALI_RACE_GAP`, com
 *   `QUALI_RACE_MIN_DUELS` duelos de cada no mínimo).
 * - Companheiros: na mesma corrida, pela mesma equipe. Duelo de grid = os dois com posição de largada; duelo de
 *   corrida = os dois com bandeirada (abandono de um deles não entra).
 * - Consistência: abandono (DNF) por largada, pontos das corridas por largada e as maiores sequências de vitórias,
 *   pódios e corridas nos pontos. Sem os pontos no resultado (api-sports), a tabela da época pela chegada.
 * - Chuva: a F1DB não marca corrida com chuva; fica no perfil editorial, com fonte.
 * - Nível (`driverTier` da base semântica): títulos, posição na história em vitórias e em GPs, temporadas.
 */
import { sql } from 'drizzle-orm';
import {
  FAVORITE_MIN_RACES,
  QUALI_RACE_GAP,
  QUALI_RACE_MIN_DUELS,
  type CircuitStat,
  type DriverTraits,
} from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import { driverTier } from '@galaxie/knowledge';
import { loadRaceTeams, type RaceTeams } from '../events/race.js';
import { pickText } from '../i18n.js';
import { standings } from './career.js';

type Result = {
  team?: { id?: unknown };
  time?: unknown;
  position_text?: unknown;
  grid?: unknown;
  points?: unknown;
} | null;

export type TraitSessionRow = {
  event_id: string;
  starts_at: string;
  year: number | null;
  stage: Record<string, string> | null;
  /** `race`, `qualifying` ou `3rd qualifying`. */
  type: string;
  venue_id: string | null;
  circuit_id: string | null;
  circuit_name: string | null;
  position: number | null;
  result: Result;
};

export type TraitMateRow = {
  event_id: string;
  mate_id: string;
  mate_name: string;
  position: number | null;
  result: Result;
};

const POLE_SESSIONS = new Set(['qualifying', '3rd qualifying']);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Chegou numa posição numérica (mesma regra da carreira). */
const classifiedAt = (r: { position: number | null; result: Result }) => {
  const text = r.result?.position_text;
  if (text != null && !/^\d+$/.test(String(text))) return null;
  if (r.result?.time === 'DNF') return null;
  return r.position;
};
const retired = (r: { result: Result }) => r.result?.position_text === 'DNF' || r.result?.time === 'DNF';
const gridOf = (r: { result: Result }) => {
  const g = num(r.result?.grid);
  return g != null && g > 0 ? g : null;
};
/** Pontos da corrida pela chegada, quando o resultado não traz (api-sports): a tabela de 2010 em diante. */
const RACE_POINTS_2010 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const racePoints = (year: number | null, r: { position: number | null; result: Result }) => {
  const p = num(r.result?.points);
  if (p != null) return p;
  const pos = classifiedAt(r);
  return pos != null && year != null && year >= 2010 ? (RACE_POINTS_2010[pos - 1] ?? 0) : 0;
};
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const avg = (list: number[], digits = 1) =>
  list.length ? round(list.reduce((a, b) => a + b, 0) / list.length, digits) : null;
const rate = (part: number, whole: number) => (whole ? round(part / whole, 3) : 0);

type Duel = { won: number; lost: number };
const duel = (): Duel => ({ won: 0, lost: 0 });
const score = (d: Duel, mine: number | null, theirs: number | null) => {
  if (mine == null || theirs == null || mine === theirs) return false;
  if (mine < theirs) d.won += 1;
  else d.lost += 1;
  return true;
};
const duelRate = (d: Duel) => (d.won + d.lost ? round(d.won / (d.won + d.lost), 3) : null);

/** Rótulo sábado × domingo pelo duelo com os companheiros (ver o comentário do módulo). */
export function qualiRaceLabel(grid: Duel, race: Duel): DriverTraits['qualifying_vs_race']['label'] {
  if (grid.won + grid.lost < QUALI_RACE_MIN_DUELS || race.won + race.lost < QUALI_RACE_MIN_DUELS) return null;
  const diff = duelRate(grid)! - duelRate(race)!;
  if (diff >= QUALI_RACE_GAP) return 'qualifier';
  if (-diff >= QUALI_RACE_GAP) return 'racer';
  return 'balanced';
}

/** Ordem das pistas preferidas: vitórias, pódios, poles, chegada média (menor é melhor), largadas. */
export const byFavorite = (a: CircuitStat, b: CircuitStat) =>
  b.wins - a.wins ||
  b.podiums - a.podiums ||
  b.poles - a.poles ||
  (a.avg_finish ?? Infinity) - (b.avg_finish ?? Infinity) ||
  b.races - a.races ||
  a.circuit.name.localeCompare(b.circuit.name);

/** Traços a partir das sessões do piloto e dos companheiros nas mesmas corridas. Puro (sem o nível). */
export function computeTraits(
  rows: TraitSessionRow[],
  mates: TraitMateRow[],
  teams: RaceTeams,
  locale: string,
): Omit<DriverTraits, 'participant_id' | 'tier'> {
  const races = rows
    .filter((r) => r.type === 'race')
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const poleRows = rows.filter((r) => POLE_SESSIONS.has(r.type) && r.position === 1);
  const ref = (r: TraitSessionRow) => ({
    event_id: r.event_id,
    name: pickText(r.stage, locale, 'Grand Prix')!,
    year: r.year ?? new Date(r.starts_at).getUTCFullYear(),
  });

  // pistas: o local do evento (os dois fornecedores apontam para o mesmo circuito)
  const circuitKey = (r: TraitSessionRow) => r.venue_id ?? `name:${r.circuit_name ?? '?'}`;
  const circuits = new Map<string, CircuitStat & { finishes: number[] }>();
  const circuit = (r: TraitSessionRow) => {
    const key = circuitKey(r);
    let c = circuits.get(key);
    if (!c)
      circuits.set(
        key,
        (c = {
          circuit: { id: r.circuit_id, venue_id: r.venue_id, name: r.circuit_name ?? '?' },
          races: 0,
          wins: 0,
          poles: 0,
          podiums: 0,
          best_finish: null,
          avg_finish: null,
          finishes: [],
        }),
      );
    // o id do F1DB (texto) vence o da api-sports (número)
    if (r.circuit_id && !/^\d+$/.test(r.circuit_id)) c.circuit.id = r.circuit_id;
    return c;
  };
  for (const r of races) {
    const c = circuit(r);
    c.races += 1;
    const pos = classifiedAt(r);
    if (pos === 1) c.wins += 1;
    if (pos != null && pos <= 3) c.podiums += 1;
    if (pos != null) c.finishes.push(pos);
  }
  for (const r of poleRows) circuit(r).poles += 1;
  const allCircuits: CircuitStat[] = [...circuits.values()]
    .filter((c) => c.races > 0)
    .map(({ finishes, ...c }) => ({
      ...c,
      circuit: { ...c.circuit, id: c.circuit.id && /^\d+$/.test(c.circuit.id) ? null : c.circuit.id },
      best_finish: finishes.length ? Math.min(...finishes) : null,
      avg_finish: avg(finishes),
    }))
    .sort(byFavorite);

  // sábado × domingo
  const grids = races.map(gridOf).filter((g): g is number => g != null);
  const finishes = races.map(classifiedAt).filter((p): p is number => p != null);
  const gained = races.flatMap((r) => {
    const g = gridOf(r);
    const p = classifiedAt(r);
    return g != null && p != null ? [g - p] : [];
  });

  // companheiros: duelo de grid e de corrida, por temporada, por companheiro e na carreira
  const raceById = new Map(races.map((r) => [r.event_id, r]));
  const career = { grid: duel(), race: duel() };
  const bySeason = new Map<
    string,
    DriverTraits['teammates']['by_season'][number] & { counted: Set<string> }
  >();
  const byMate = new Map<
    string,
    DriverTraits['teammates']['by_teammate'][number] & { years: Set<number>; counted: Set<string> }
  >();
  for (const m of mates) {
    const mine = raceById.get(m.event_id);
    if (!mine) continue;
    const year = ref(mine).year;
    const teamId = mine.result?.team?.id == null ? '' : String(mine.result.team.id);
    const team = teams.get(teamId);
    const sKey = `${year}|${m.mate_id}|${team?.id ?? teamId}`;
    let s = bySeason.get(sKey);
    if (!s)
      bySeason.set(
        sKey,
        (s = {
          year,
          teammate: { id: m.mate_id, name: m.mate_name },
          team: { id: team?.id ?? teamId, name: team?.name ?? teamId },
          races: 0,
          grid: duel(),
          race: duel(),
          counted: new Set(),
        }),
      );
    let t = byMate.get(m.mate_id);
    if (!t)
      byMate.set(
        m.mate_id,
        (t = {
          teammate: { id: m.mate_id, name: m.mate_name },
          seasons: [],
          races: 0,
          grid: duel(),
          race: duel(),
          years: new Set(),
          counted: new Set(),
        }),
      );
    if (!s.counted.has(m.event_id)) {
      s.counted.add(m.event_id);
      s.races += 1;
    }
    if (!t.counted.has(m.event_id)) {
      t.counted.add(m.event_id);
      t.races += 1;
    }
    t.years.add(year);
    const mineGrid = gridOf(mine);
    const theirGrid = gridOf(m);
    if (score(s.grid, mineGrid, theirGrid)) {
      score(t.grid, mineGrid, theirGrid);
      score(career.grid, mineGrid, theirGrid);
    }
    const mineAt = classifiedAt(mine);
    const theirAt = classifiedAt(m);
    if (score(s.race, mineAt, theirAt)) {
      score(t.race, mineAt, theirAt);
      score(career.race, mineAt, theirAt);
    }
  }

  // consistência e sequências
  const points = races.reduce((n, r) => n + racePoints(r.year, r), 0);
  const streak = (hit: (r: TraitSessionRow) => boolean) => {
    let best = { length: 0, from: null as TraitSessionRow | null, to: null as TraitSessionRow | null };
    let run = 0;
    let start: TraitSessionRow | null = null;
    for (const r of races) {
      if (!hit(r)) {
        run = 0;
        continue;
      }
      if (run === 0) start = r;
      run += 1;
      if (run > best.length) best = { length: run, from: start, to: r };
    }
    return {
      length: best.length,
      from: best.from ? ref(best.from) : null,
      to: best.to ? ref(best.to) : null,
    };
  };
  const dnfs = races.filter(retired).length;

  return {
    circuits: {
      criterion: { order: ['wins', 'podiums', 'poles', 'avg_finish'], min_races: FAVORITE_MIN_RACES },
      favorites: allCircuits.filter((c) => c.races >= FAVORITE_MIN_RACES).slice(0, 3),
      all: allCircuits,
    },
    qualifying_vs_race: {
      races: races.length,
      poles: poleRows.length,
      pole_rate: rate(poleRows.length, races.length),
      avg_grid: avg(grids),
      avg_finish: avg(finishes),
      avg_positions_gained: avg(gained, 2),
      label: qualiRaceLabel(career.grid, career.race),
      grid_duel_rate: duelRate(career.grid),
      race_duel_rate: duelRate(career.race),
    },
    teammates: {
      career,
      by_teammate: [...byMate.values()]
        .map(({ years, counted: _, ...t }) => ({ ...t, seasons: [...years].sort((a, b) => a - b) }))
        .sort((a, b) => b.races - a.races || a.teammate.name.localeCompare(b.teammate.name)),
      by_season: [...bySeason.values()]
        .map(({ counted: _, ...s }) => s)
        .sort((a, b) => b.year - a.year || b.races - a.races),
    },
    consistency: {
      races: races.length,
      dnfs,
      dnf_rate: rate(dnfs, races.length),
      points: round(points, 1),
      points_per_start: races.length ? round(points / races.length, 2) : 0,
      streaks: {
        wins: streak((r) => classifiedAt(r) === 1),
        podiums: streak((r) => {
          const p = classifiedAt(r);
          return p != null && p <= 3;
        }),
        points: streak((r) => racePoints(r.year, r) > 0),
      },
    },
  };
}

/** Nível do piloto: títulos (temporadas encerradas em 1º) e posição na história em vitórias e em GPs. */
async function tierOf(db: Database, participantId: string): Promise<DriverTraits['tier']> {
  const [row] = await db.execute<{
    wins: string;
    seasons: string;
    wins_rank: string;
    starts_rank: string;
  }>(sql`
    with races as (
      select ep.participant_id, se.year,
             (ep.position = 1 and coalesce(ep.result->>'position_text', '1') ~ '^[0-9]+$'
              and coalesce(ep.result->>'time', '') <> 'DNF') as win
        from core.event_participant ep
        join core.event e on e.id = ep.event_id and e.sport = 'formula-1' and e.status = 'finished'
        join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
        left join core.season se on se.id = e.season_id
    ),
    totals as (
      select participant_id, count(*) as starts, count(*) filter (where win) as wins,
             count(distinct year) as seasons
        from races group by participant_id
    )
    select t.wins, t.seasons,
           (select 1 + count(*) from totals o where o.wins > t.wins) as wins_rank,
           (select 1 + count(*) from totals o where o.starts > t.starts) as starts_rank
      from totals t
     where t.participant_id = ${participantId}::uuid`);
  if (!row) return 'basic';
  const titles = [...(await standings(db, participantId, 'drivers')).values()].filter(
    (s) => s.finished && s.rank === 1,
  ).length;
  return driverTier({
    titles,
    wins: Number(row.wins),
    seasons: Number(row.seasons),
    winsRank: Number(row.wins_rank),
    startsRank: Number(row.starts_rank),
  });
}

export async function loadDriverTraits(
  db: Database,
  participantId: string,
  locale: string,
  assetsBaseUrl: string | undefined,
): Promise<DriverTraits> {
  const rows = await db.execute<TraitSessionRow>(sql`
    select e.id as event_id, e.starts_at, se.year, st.name as stage, lower(sd.summary->>'type') as type,
           e.venue_id, sd.summary->'circuit'->>'id' as circuit_id,
           coalesce(v.name, sd.summary->'circuit'->>'name') as circuit_name,
           ep.position, ep.result
      from core.event_participant ep
      join core.event e on e.id = ep.event_id and e.sport = 'formula-1' and e.status = 'finished'
      join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race'
      left join core.season se on se.id = e.season_id
      left join core.stage st on st.id = e.stage_id
      left join core.venue v on v.id = e.venue_id
     where ep.participant_id = ${participantId}::uuid
       and lower(sd.summary->>'type') in ('race', 'qualifying', '3rd qualifying')
     order by e.starts_at`);
  const mates = await db.execute<TraitMateRow>(sql`
    select mine.event_id, mate.participant_id as mate_id, p.name as mate_name, mate.position, mate.result
      from core.event_participant mine
      join core.sport_event_detail sd on sd.event_id = mine.event_id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
      join core.event_participant mate on mate.event_id = mine.event_id and mate.participant_id <> mine.participant_id
           and mate.result->'team'->>'id' = mine.result->'team'->>'id'
      join core.participant p on p.id = mate.participant_id
     where mine.participant_id = ${participantId}::uuid`);
  const teams = await loadRaceTeams(
    db,
    'formula-1',
    rows.filter((r) => r.type === 'race').map((r) => r.result),
    assetsBaseUrl,
  );
  return {
    participant_id: participantId,
    tier: await tierOf(db, participantId),
    ...computeTraits(rows, mates, teams, locale),
  };
}
