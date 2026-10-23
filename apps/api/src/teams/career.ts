/**
 * Carreira na Fórmula 1 de um piloto ou de um construtor, calculada do core (F1DB + api-sports): temporada a
 * temporada (posição e pontos do campeonato, corridas, vitórias, poles, pódios, voltas mais rápidas), títulos,
 * melhor resultado, primeira corrida, primeira vitória, última corrida, equipes e companheiros de equipe.
 *
 * - Corrida = sessão `Race` (sprint fora); pole = 1º na classificação do GP (`Qualifying` do F1DB ou `3rd
 *   Qualifying` da api-sports); volta mais rápida = o piloto do `fastest_lap` do espelho da corrida.
 * - Pódio só com posição numérica de chegada (abandono ordenado não conta).
 */
import { sql } from 'drizzle-orm';
import type { CareerSeason, Photo, RaceCareer } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import { constructorProviderIds, loadRaceTeams, RACE_PROVIDERS, type RaceTeams } from '../events/race.js';
import { pickText } from '../i18n.js';
import { assetUrl } from '../util.js';
import { photoHighlights } from './highlights.js';
import { loadPhotos } from './photos.js';

type SessionRow = {
  event_id: string;
  starts_at: string;
  year: number | null;
  stage: Record<string, string> | null;
  type: string | null;
  fastest: string | null;
  participant_id: string;
  position: number | null;
  result: { team?: { id?: unknown; name?: unknown }; time?: unknown; position_text?: unknown } | null;
};

const POLE_SESSIONS = new Set(['qualifying', '3rd qualifying']);
const teamKey = (r: SessionRow) => (r.result?.team?.id == null ? null : String(r.result.team.id));
/** Chegou numa posição numérica (abandono ordenado pela api-sports vem com `time: "DNF"`). */
const classifiedAt = (r: SessionRow) => {
  const text = r.result?.position_text;
  if (text != null && !/^\d+$/.test(String(text))) return null;
  if (r.result?.time === 'DNF') return null;
  return r.position;
};

/** Sessões de corrida e de classificação com o participante (ou com os pilotos de uma equipe). */
async function sessions(db: Database, where: ReturnType<typeof sql>): Promise<SessionRow[]> {
  return db.execute<SessionRow>(sql`
    select e.id as event_id, e.starts_at, se.year, st.name as stage, sd.summary->>'type' as type,
           sd.summary->'fastest_lap'->'driver'->>'id' as fastest,
           ep.participant_id, ep.position, ep.result
      from core.event_participant ep
      join core.event e on e.id = ep.event_id and e.sport = 'formula-1' and e.status = 'finished'
      join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race'
      left join core.season se on se.id = e.season_id
      left join core.stage st on st.id = e.stage_id
     where ${where}
       and lower(sd.summary->>'type') in ('race', 'qualifying', '3rd qualifying')
     order by e.starts_at`);
}

/**
 * Classificação do campeonato do participante, por ano. `finished`: temporada encerrada (ano anterior ao atual,
 * ou com corridas e nenhuma ainda por vir) — a liderança de uma temporada em andamento não é título.
 */
async function standings(db: Database, participantId: string, group: 'drivers' | 'constructors') {
  const rows = await db.execute<{ year: number; rank: number; points: number; finished: boolean }>(sql`
    select se.year, s.rank, s.points,
           (se.year < extract(year from now())::int
            or (exists (select 1 from core.event e
                          join core.sport_event_detail sd on sd.event_id = e.id
                         where e.season_id = se.id and lower(sd.summary->>'type') = 'race')
                and not exists (select 1 from core.event e
                                  join core.sport_event_detail sd on sd.event_id = e.id
                                 where e.season_id = se.id and lower(sd.summary->>'type') = 'race'
                                   and e.starts_at > now() - interval '3 hours'))) as finished
      from core.standing s
      join core.season se on se.id = s.season_id
      join core.competition c on c.id = se.competition_id and c.sport = 'formula-1'
     where s.participant_id = ${participantId}::uuid and s.group = ${group}`);
  return new Map(
    rows.map((r) => [
      Number(r.year),
      { rank: Number(r.rank), points: Number(r.points), finished: !!r.finished },
    ]),
  );
}

/** IDs de piloto nas fontes ("25", "ayrton-senna"), como aparecem no `fastest_lap`, por participante. */
async function driverKeys(db: Database, participantIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!participantIds.length) return out;
  const rows = await db.execute<{ entity_id: string; provider_id: string }>(sql`
    select entity_id::text, provider_id from core.provider_map
     where entity_type = 'participant'
       and entity_id in (${sql.join(
         participantIds.map((p) => sql`${p}::uuid`),
         sql`, `,
       )})
       and provider in (${sql.join(
         RACE_PROVIDERS.map((p) => sql`${p}`),
         sql`, `,
       )})`);
  for (const r of rows)
    out.set(r.entity_id, (out.get(r.entity_id) ?? new Set()).add(r.provider_id.replace(/^driver-/, '')));
  return out;
}

const raceRef = (r: SessionRow | undefined, locale: string) =>
  r
    ? {
        event_id: r.event_id,
        name: pickText(r.stage, locale, 'Grand Prix')!,
        date: new Date(r.starts_at).toISOString(),
        position: classifiedAt(r),
      }
    : null;

function emptySeason(year: number): CareerSeason {
  return {
    year,
    position: null,
    final: false,
    points: null,
    races: 0,
    wins: 0,
    poles: 0,
    podiums: 0,
    fastest_laps: 0,
    teams: [],
    car: null,
  };
}

export async function loadRaceCareer(
  db: Database,
  participant: { id: string; kind: string },
  locale: string,
  assetsBaseUrl: string | undefined,
): Promise<RaceCareer> {
  const constructor = participant.kind === 'constructor';
  const ids = constructor ? await constructorProviderIds(db, participant.id) : [];
  const rows = constructor
    ? ids.length
      ? await sessions(
          db,
          sql`ep.result->'team'->>'id' in (${sql.join(
            ids.map((i) => sql`${i}`),
            sql`, `,
          )})`,
        )
      : []
    : await sessions(db, sql`ep.participant_id = ${participant.id}::uuid`);
  const races = rows.filter((r) => (r.type ?? '').toLowerCase() === 'race');
  // volta mais rápida: o espelho traz o id do piloto no fornecedor ("25", "ayrton-senna")
  const keysOf = await driverKeys(db, [...new Set(races.map((r) => r.participant_id))]);
  const fastestBy = (r: SessionRow) => !!r.fastest && !!keysOf.get(r.participant_id)?.has(r.fastest);

  const teams: RaceTeams = await loadRaceTeams(
    db,
    'formula-1',
    rows.map((r) => r.result),
    assetsBaseUrl,
  );
  const drivers = constructor
    ? await db.execute<{ id: string; name: string }>(sql`
        select id, name from core.participant where id in (${sql.join(
          [...new Set(races.map((r) => r.participant_id)), '00000000-0000-0000-0000-000000000000'].map(
            (p) => sql`${p}::uuid`,
          ),
          sql`, `,
        )})`)
    : [];
  const driverName = new Map(drivers.map((d) => [d.id, d.name]));

  const table = await standings(db, participant.id, constructor ? 'constructors' : 'drivers');
  const seasons = new Map<number, CareerSeason>();
  const season = (y: number) => {
    let s = seasons.get(y);
    if (!s) seasons.set(y, (s = emptySeason(y)));
    return s;
  };
  type SeasonTeam = CareerSeason['teams'][number];
  const seasonTeams = new Map<number, Map<string, SeasonTeam>>();
  const addTeam = (y: number, t: SeasonTeam) => {
    const m = seasonTeams.get(y) ?? new Map();
    m.set(t.id, t);
    seasonTeams.set(y, m);
  };
  const countedFastest = new Set<string>();
  const countedRaces = new Set<string>();
  for (const r of rows) {
    if (r.year == null) continue;
    const s = season(Number(r.year));
    const type = (r.type ?? '').toLowerCase();
    if (POLE_SESSIONS.has(type)) {
      if (r.position === 1) s.poles += 1;
      continue;
    }
    // equipe: uma corrida conta uma vez; pódios e vitórias somam os pilotos dela
    if (!countedRaces.has(r.event_id)) {
      countedRaces.add(r.event_id);
      s.races += 1;
    }
    const pos = classifiedAt(r);
    if (pos === 1) s.wins += 1;
    if (pos != null && pos <= 3) s.podiums += 1;
    if (fastestBy(r) && !countedFastest.has(r.event_id)) {
      countedFastest.add(r.event_id);
      s.fastest_laps += 1;
    }
    if (constructor)
      addTeam(Number(r.year), {
        id: r.participant_id,
        name: driverName.get(r.participant_id) ?? '?',
        logo: null,
      });
    else {
      const t = teams.get(teamKey(r) ?? '');
      if (t) addTeam(Number(r.year), t);
    }
  }
  for (const [year, st] of table) {
    const s = season(year);
    s.position = st.rank;
    s.final = st.finished;
    s.points = st.points;
  }
  for (const [year, m] of seasonTeams) season(year).teams = [...m.values()];

  // fotos: retrato do participante; carro de cada temporada (do construtor; no piloto, das equipes dele)
  const constructorsOf = new Map<number, string[]>();
  for (const [year, s] of seasons)
    constructorsOf.set(year, constructor ? [participant.id] : s.teams.map((t) => t.id));
  const photoOwners = [...new Set([participant.id, ...[...constructorsOf.values()].flat()])];
  const photos = await loadPhotos(db, photoOwners, assetsBaseUrl);
  const portrait = (photos.get(participant.id) ?? []).find((p) => p.role === 'portrait') ?? null;
  // foto de fundo do heading escolhida pela curadoria (por id do F1DB), entre as do piloto e as dos carros dele
  const highlightFile = constructor
    ? undefined
    : [...(keysOf.get(participant.id) ?? [])].map((k) => photoHighlights().get(k)).find(Boolean);
  const highlight = highlightFile
    ? ([...photos.values()].flat().find((p) => p.credit.title === highlightFile) ?? null)
    : null;
  for (const [year, owners] of constructorsOf) {
    let car: Photo | null = null;
    for (const o of owners)
      car ??= (photos.get(o) ?? []).find((p) => p.role === 'car' && p.season === year) ?? null;
    season(year).car = car;
  }

  const list = [...seasons.values()].sort((a, b) => b.year - a.year);
  const titles = list
    .filter((s) => s.final && s.position === 1)
    .map((s) => s.year)
    .sort((a, b) => a - b);
  const finishes = races.map(classifiedAt).filter((p): p is number => p != null);

  // equipes da carreira (piloto) em ordem, com o primeiro e o último ano
  const careerTeams = new Map<
    string,
    { id: string; name: string; logo: string | null; from: number; to: number }
  >();
  if (!constructor)
    for (const s of [...list].reverse())
      for (const t of s.teams) {
        const prev = careerTeams.get(t.id);
        careerTeams.set(t.id, prev ? { ...prev, to: s.year } : { ...t, from: s.year, to: s.year });
      }

  // companheiros: na mesma corrida, pela mesma equipe
  const teammates = constructor
    ? []
    : await db.execute<{
        id: string;
        name: string;
        races: string;
        seasons: number[];
        logo_key: string | null;
        logo_url: string | null;
      }>(sql`
        select p.id, p.name, count(distinct mine.event_id) as races, array_agg(distinct se.year order by se.year) as seasons,
               min(a.storage_key) as logo_key, min(a.source_url) as logo_url
          from core.event_participant mine
          join core.sport_event_detail sd on sd.event_id = mine.event_id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
          join core.event e on e.id = mine.event_id
          left join core.season se on se.id = e.season_id
          join core.event_participant mate on mate.event_id = mine.event_id and mate.participant_id <> mine.participant_id
               and mate.result->'team'->>'id' = mine.result->'team'->>'id'
          join core.participant p on p.id = mate.participant_id
          left join core.asset a on a.id = p.logo_asset_id
         where mine.participant_id = ${participant.id}::uuid
         group by p.id, p.name
         order by count(distinct mine.event_id) desc, p.name
         limit 40`);

  return {
    participant_id: participant.id,
    kind: constructor ? 'constructor' : 'driver',
    totals: {
      seasons: list.filter((s) => s.races > 0).length,
      races: list.reduce((n, s) => n + s.races, 0),
      wins: list.reduce((n, s) => n + s.wins, 0),
      poles: list.reduce((n, s) => n + s.poles, 0),
      podiums: list.reduce((n, s) => n + s.podiums, 0),
      fastest_laps: list.reduce((n, s) => n + s.fastest_laps, 0),
      points: list.reduce((n, s) => n + (s.points ?? 0), 0),
      titles: titles.length,
    },
    titles,
    best_finish: finishes.length ? Math.min(...finishes) : null,
    first_race: raceRef(races[0], locale),
    first_win: raceRef(
      races.find((r) => classifiedAt(r) === 1),
      locale,
    ),
    last_race: raceRef(races.at(-1), locale),
    teams: [...careerTeams.values()],
    teammates: teammates.map((m) => ({
      id: m.id,
      name: m.name,
      logo: assetUrl(assetsBaseUrl, m.logo_key, m.logo_url),
      races: Number(m.races),
      seasons: (m.seasons ?? []).map(Number),
    })),
    seasons: list,
    portrait,
    highlight,
  };
}
