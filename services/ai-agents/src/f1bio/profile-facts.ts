/**
 * Fatos do F1DB (core) para o perfil editorial: o nível de cada piloto (`driverTier` da base semântica), os números
 * da carreira e a lista de corridas que o modelo usa para citar momentos (a chave `<ano>-<rodada>`; rodada = a ordem
 * da corrida na temporada pela data, a mesma que a API usa para achar o evento). Os números daqui formam o
 * FactSheet que confere o texto gerado.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import { driverTier, type DriverTier } from '@galaxie/knowledge';
import type { DriverFacts } from './propose.js';

export interface ProfileRace {
  /** `<ano>-<rodada>` (1993-03). */
  key: string;
  year: number;
  round: number;
  /** Nome do GP na base (inglês, do F1DB). */
  gp: string;
  circuit: string | null;
  grid: number | null;
  /** Chegada com bandeirada; null = abandono ou não classificado. */
  finish: number | null;
  /** `position_text` quando não terminou (DNF, DSQ...). */
  status: string | null;
  /** Data da corrida (ISO, dia). */
  date: string;
}

export interface ProfileFacts extends DriverFacts {
  tier: DriverTier;
  /** Nascimento (ISO), do F1DB. */
  birthDate: string | null;
  poles: number;
  podiums: number;
  points: number;
  seasonStats: {
    year: number;
    position: number | null;
    points: number | null;
    wins: number;
    podiums: number;
  }[];
  /** Circuitos com vitória ou pódio, do melhor para o pior. */
  circuits: { name: string; races: number; wins: number; podiums: number }[];
  racesList: ProfileRace[];
  teammates: { name: string; races: number }[];
  /** Pilotos que largaram nas mesmas corridas (para ligar o rival ao F1DB). */
  contemporaries: { f1dbId: string; name: string }[];
}

/** Piloto do F1DB com o nível calculado (a lista de onde saem os escopos `lendas` e `regulares`). */
export interface RosterEntry {
  f1dbId: string;
  name: string;
  tier: DriverTier;
  titles: number;
  wins: number;
  starts: number;
}

const WIN = sql`(ep.position = 1 and coalesce(ep.result->>'position_text', '1') ~ '^[0-9]+$'
                 and coalesce(ep.result->>'time', '') <> 'DNF')`;
const FINISHED_SEASON = sql`(se.year < extract(year from now())::int or se.end_date < current_date)`;

/** Todos os pilotos do F1DB com largada, com o nível (lendas primeiro, por títulos, vitórias e GPs). */
export async function driverRoster(db: Database): Promise<RosterEntry[]> {
  const rows = await db.execute<{
    f1db_id: string;
    name: string;
    titles: string;
    wins: string;
    starts: string;
    seasons: string;
    wins_rank: string;
    starts_rank: string;
  }>(sql`
    with races as (
      select ep.participant_id, se.year, ${WIN} as win
        from core.event_participant ep
        join core.event e on e.id = ep.event_id and e.sport = 'formula-1' and e.status = 'finished'
        join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
        left join core.season se on se.id = e.season_id
    ),
    totals as (
      select participant_id, count(*) as starts, count(*) filter (where win) as wins, count(distinct year) as seasons
        from races group by participant_id
    ),
    titles as (
      select s.participant_id, count(*) as titles
        from core.standing s
        join core.season se on se.id = s.season_id
        join core.competition c on c.id = se.competition_id and c.sport = 'formula-1'
       where s.group = 'drivers' and s.rank = 1 and ${FINISHED_SEASON}
       group by s.participant_id
    )
    select replace(pm.provider_id, 'driver-', '') as f1db_id, p.name, coalesce(ti.titles, 0) as titles,
           t.wins, t.starts, t.seasons,
           (select 1 + count(*) from totals o where o.wins > t.wins) as wins_rank,
           (select 1 + count(*) from totals o where o.starts > t.starts) as starts_rank
      from totals t
      join core.participant p on p.id = t.participant_id
      join core.provider_map pm on pm.entity_id = t.participant_id and pm.provider = 'f1db'
           and pm.entity_type = 'participant' and pm.provider_id like 'driver-%'
      left join titles ti on ti.participant_id = t.participant_id`);
  const order: Record<DriverTier, number> = { legend: 0, regular: 1, basic: 2 };
  return rows
    .map((r) => {
      const titles = Number(r.titles);
      const wins = Number(r.wins);
      const starts = Number(r.starts);
      return {
        f1dbId: r.f1db_id,
        name: r.name,
        titles,
        wins,
        starts,
        tier: driverTier({
          titles,
          wins,
          seasons: Number(r.seasons),
          winsRank: Number(r.wins_rank),
          startsRank: Number(r.starts_rank),
        }),
      };
    })
    .sort(
      (a, b) =>
        order[a.tier] - order[b.tier] ||
        b.titles - a.titles ||
        b.wins - a.wins ||
        b.starts - a.starts ||
        a.f1dbId.localeCompare(b.f1dbId),
    );
}

type RaceRow = {
  date: string;
  year: number;
  round: number;
  gp: Record<string, string> | null;
  circuit: string | null;
  position: number | null;
  result: { grid?: unknown; position_text?: unknown; time?: unknown; points?: unknown } | null;
  [key: string]: unknown;
};

/** Os fatos de um piloto (com a lista de corridas), a partir dos fatos-base da biografia. */
export async function profileFacts(db: Database, base: DriverFacts, tier: DriverTier): Promise<ProfileFacts> {
  const pid = `driver-${base.f1dbId}`;
  const me = sql`(select entity_id from core.provider_map
                   where provider = 'f1db' and entity_type = 'participant' and provider_id = ${pid} limit 1)`;
  const rows = await db.execute<RaceRow>(sql`
    with season_races as (
      select e.id, e.season_id, e.starts_at, e.venue_id, e.stage_id, sd.summary,
             dense_rank() over (partition by e.season_id order by e.starts_at::date)::int as round
        from core.event e
        join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
       where e.sport = 'formula-1' and e.status = 'finished'
         and e.season_id in (select e2.season_id from core.event_participant ep2
                               join core.event e2 on e2.id = ep2.event_id where ep2.participant_id = ${me})
    )
    select to_char(r.starts_at, 'YYYY-MM-DD') as date, se.year, r.round, st.name as gp, coalesce(v.name, r.summary->'circuit'->>'name') as circuit,
           ep.position, ep.result
      from season_races r
      join core.event_participant ep on ep.event_id = r.id and ep.participant_id = ${me}
      join core.season se on se.id = r.season_id
      left join core.stage st on st.id = r.stage_id
      left join core.venue v on v.id = r.venue_id
     order by r.starts_at`);
  const [poles] = await db.execute<{ n: string }>(sql`
    select count(*) as n from core.event_participant ep
      join core.event e on e.id = ep.event_id and e.sport = 'formula-1' and e.status = 'finished'
      join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race'
     where ep.participant_id = ${me} and ep.position = 1
       and lower(sd.summary->>'type') in ('qualifying', '3rd qualifying')`);
  const standings = await db.execute<{ year: number; rank: number; points: number; finished: boolean }>(sql`
    select se.year, s.rank, s.points, ${FINISHED_SEASON} as finished
      from core.standing s
      join core.season se on se.id = s.season_id
      join core.competition c on c.id = se.competition_id and c.sport = 'formula-1'
     where s.participant_id = ${me} and s.group = 'drivers'`);
  const teammates = await db.execute<{ name: string; races: string }>(sql`
    select p.name, count(distinct mine.event_id) as races
      from core.event_participant mine
      join core.sport_event_detail sd on sd.event_id = mine.event_id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
      join core.event_participant mate on mate.event_id = mine.event_id and mate.participant_id <> mine.participant_id
           and mate.result->'team'->>'id' = mine.result->'team'->>'id'
      join core.participant p on p.id = mate.participant_id
     where mine.participant_id = ${me}
     group by p.name order by count(distinct mine.event_id) desc limit 12`);
  const [birth] = await db.execute<{ birth_date: string | null }>(
    sql`select to_char(birth_date, 'YYYY-MM-DD') as birth_date from core.participant where id = ${me}`,
  );
  const contemporaries = await db.execute<{ f1db_id: string; name: string }>(sql`
    select distinct replace(pm.provider_id, 'driver-', '') as f1db_id, p.name
      from core.event_participant mine
      join core.sport_event_detail sd on sd.event_id = mine.event_id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
      join core.event_participant other on other.event_id = mine.event_id and other.participant_id <> mine.participant_id
      join core.participant p on p.id = other.participant_id
      join core.provider_map pm on pm.entity_id = p.id and pm.provider = 'f1db' and pm.entity_type = 'participant'
           and pm.provider_id like 'driver-%'
     where mine.participant_id = ${me}`);

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const racesList: ProfileRace[] = rows.map((r) => {
    const text = r.result?.position_text == null ? null : String(r.result.position_text);
    const classified = (text == null || /^\d+$/.test(text)) && r.result?.time !== 'DNF';
    const grid = num(r.result?.grid);
    const year = Number(r.year);
    const round = Number(r.round);
    return {
      key: `${year}-${String(round).padStart(2, '0')}`,
      year,
      round,
      gp: r.gp?.en ?? r.gp?.['pt-BR'] ?? Object.values(r.gp ?? {})[0] ?? 'Grand Prix',
      circuit: r.circuit,
      grid: grid != null && grid > 0 ? grid : null,
      finish: classified ? r.position : null,
      status: classified ? null : text,
      date: r.date,
    };
  });
  const points = rows.reduce((n, r) => n + (num(r.result?.points) ?? 0), 0);
  const byYear = new Map<number, { wins: number; podiums: number }>();
  const byCircuit = new Map<string, { name: string; races: number; wins: number; podiums: number }>();
  for (const r of racesList) {
    const y = byYear.get(r.year) ?? { wins: 0, podiums: 0 };
    const c = byCircuit.get(r.circuit ?? '?') ?? { name: r.circuit ?? '?', races: 0, wins: 0, podiums: 0 };
    c.races += 1;
    if (r.finish === 1) {
      y.wins += 1;
      c.wins += 1;
    }
    if (r.finish != null && r.finish <= 3) {
      y.podiums += 1;
      c.podiums += 1;
    }
    byYear.set(r.year, y);
    byCircuit.set(r.circuit ?? '?', c);
  }
  const table = new Map(standings.map((s) => [Number(s.year), s]));
  return {
    ...base,
    titles: standings
      .filter((s) => s.finished && Number(s.rank) === 1)
      .map((s) => Number(s.year))
      .sort((a, b) => a - b),
    tier,
    birthDate: birth?.birth_date ?? null,
    poles: Number(poles?.n ?? 0),
    podiums: racesList.filter((r) => r.finish != null && r.finish <= 3).length,
    points: Math.round(points * 10) / 10,
    seasonStats: [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, s]) => ({
        year,
        position: table.has(year) ? Number(table.get(year)!.rank) : null,
        points: table.has(year) ? Number(table.get(year)!.points) : null,
        ...s,
      })),
    circuits: [...byCircuit.values()]
      .filter((c) => c.podiums > 0)
      .sort((a, b) => b.wins - a.wins || b.podiums - a.podiums || b.races - a.races),
    racesList,
    teammates: teammates.map((t) => ({ name: t.name, races: Number(t.races) })),
    contemporaries: contemporaries.map((c) => ({ f1dbId: c.f1db_id, name: c.name })),
  };
}
