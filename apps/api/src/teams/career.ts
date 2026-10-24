/**
 * Carreira na Fórmula 1 de um piloto ou de um construtor, calculada do core (F1DB + api-sports): temporada a
 * temporada (posição e pontos do campeonato, corridas, vitórias, poles, pódios, voltas mais rápidas), títulos,
 * melhor resultado, primeira corrida, primeira vitória, última corrida, equipes e companheiros de equipe.
 *
 * - Corrida = sessão `Race` (sprint fora); pole = 1º na classificação do GP (`Qualifying` do F1DB ou `3rd
 *   Qualifying` da api-sports); volta mais rápida = o piloto do `fastest_lap` do espelho da corrida.
 * - Pódio só com posição numérica de chegada (abandono ordenado não conta).
 * - Sprint: a sessão `Sprint`; pole da sprint = 1º na classificação dela (`Sprint Qualifying` do F1DB ou `3rd Sprint
 *   Shootout` da api-sports, de 2023 em diante); pontos da sprint = os do resultado ou, sem eles (api-sports), a
 *   tabela da época pela posição.
 * - Abandono (DNF) = `position_text`/`time` "DNF" (desclassificação e não classificado não contam); top 10 =
 *   chegada entre os dez primeiros; largada = `grid` do resultado (largada dos boxes não conta).
 * - Número do carro na temporada = o mais usado nas sessões dela; sem ele (api-sports), o permanente, de 2014 em
 *   diante. Cores da equipe na temporada = a pintura curada por época (`formula-1/liveries.yaml`).
 */
import { sql } from 'drizzle-orm';
import {
  teamGradient,
  type CareerSeason,
  type Photo,
  type RaceCareer,
  type TeamLivery,
} from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import { liveryFor, type LiveryEntry } from '@galaxie/knowledge';
import { constructorProviderIds, loadRaceTeams, RACE_PROVIDERS, type RaceTeams } from '../events/race.js';
import { pickText } from '../i18n.js';
import { assetUrl } from '../util.js';
import { loadPhotos } from './photos.js';

type SessionRow = {
  event_id: string;
  competition_id: string | null;
  starts_at: string;
  year: number | null;
  stage: Record<string, string> | null;
  type: string | null;
  fastest: string | null;
  participant_id: string;
  position: number | null;
  result: {
    team?: { id?: unknown; name?: unknown };
    time?: unknown;
    position_text?: unknown;
    grid?: unknown;
    number?: unknown;
    points?: unknown;
  } | null;
};

const POLE_SESSIONS = new Set(['qualifying', '3rd qualifying']);
const SPRINT_POLE_SESSIONS = new Set(['sprint qualifying', '3rd sprint shootout']);
const SESSION_TYPES = ['race', 'sprint', ...POLE_SESSIONS, ...SPRINT_POLE_SESSIONS];
/** Pontos da sprint pela posição, quando o resultado não traz (a api-sports não traz): 2021 e 2022 em diante. */
const sprintPointsAt = (year: number, pos: number | null) => {
  const table = year >= 2022 ? [8, 7, 6, 5, 4, 3, 2, 1] : year === 2021 ? [3, 2, 1] : [];
  return pos == null ? 0 : (table[pos - 1] ?? 0);
};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const teamKey = (r: SessionRow) => (r.result?.team?.id == null ? null : String(r.result.team.id));
/** Chegou numa posição numérica (abandono ordenado pela api-sports vem com `time: "DNF"`). */
const classifiedAt = (r: SessionRow) => {
  const text = r.result?.position_text;
  if (text != null && !/^\d+$/.test(String(text))) return null;
  if (r.result?.time === 'DNF') return null;
  return r.position;
};
const retired = (r: SessionRow) => r.result?.position_text === 'DNF' || r.result?.time === 'DNF';
const gridOf = (r: SessionRow) => {
  const g = num(r.result?.grid);
  return g != null && g > 0 ? g : null;
};

/** Sessões de corrida e de classificação com o participante (ou com os pilotos de uma equipe). */
async function sessions(db: Database, where: ReturnType<typeof sql>): Promise<SessionRow[]> {
  return db.execute<SessionRow>(sql`
    select e.id as event_id, e.competition_id, e.starts_at, se.year, st.name as stage, sd.summary->>'type' as type,
           sd.summary->'fastest_lap'->'driver'->>'id' as fastest,
           ep.participant_id, ep.position, ep.result
      from core.event_participant ep
      join core.event e on e.id = ep.event_id and e.sport = 'formula-1' and e.status = 'finished'
      join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race'
      left join core.season se on se.id = e.season_id
      left join core.stage st on st.id = e.stage_id
     where ${where}
       and lower(sd.summary->>'type') in (${sql.join(
         SESSION_TYPES.map((t) => sql`${t}`),
         sql`, `,
       )})
     order by e.starts_at`);
}

/**
 * Classificação do campeonato do participante, por ano. `finished`: temporada encerrada (ano anterior ao atual,
 * ou já passado o último GP do calendário, com corridas e nenhuma ainda por vir) — a liderança de uma temporada em
 * andamento não é título. O fim do calendário (`season.end_date`) vale mesmo quando os GPs futuros ainda não são
 * eventos na base (o F1DB só traz sessão com resultado).
 */
async function standings(db: Database, participantId: string, group: 'drivers' | 'constructors') {
  const rows = await db.execute<{ year: number; rank: number; points: number; finished: boolean }>(sql`
    select se.year, s.rank, s.points,
           (se.year < extract(year from now())::int
            or ((se.end_date is null or se.end_date < current_date)
                and exists (select 1 from core.event e
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

/**
 * IDs do construtor no F1DB por participante (a chave da pintura curada). Uma entidade pode ter mais de um (RB e
 * Racing Bulls são a mesma equipe).
 */
export async function f1dbIds(db: Database, participantIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!participantIds.length) return out;
  const rows = await db.execute<{ entity_id: string; provider_id: string }>(sql`
    select entity_id::text, provider_id from core.provider_map
     where entity_type = 'participant' and provider = 'f1db'
       and entity_id in (${sql.join(
         participantIds.map((p) => sql`${p}::uuid`),
         sql`, `,
       )})
     order by provider_id`);
  for (const r of rows) out.set(r.entity_id, [...(out.get(r.entity_id) ?? []), r.provider_id]);
  return out;
}

/** "Kimi Antonelli" + sobrenome "Antonelli" → Kimi / Antonelli; sem sobrenome que feche o nome, a última palavra. */
export function splitName(name: string, shortName: string | null): { first: string; last: string } {
  const full = name.trim();
  const short = shortName?.trim();
  if (short && full.length > short.length && full.toLowerCase().endsWith(` ${short.toLowerCase()}`))
    return { first: full.slice(0, -short.length).trim(), last: full.slice(-short.length) };
  const i = full.lastIndexOf(' ');
  return i > 0 ? { first: full.slice(0, i), last: full.slice(i + 1) } : { first: '', last: full };
}

/** Nome em duas partes, número permanente e nascimento do piloto. */
async function driverProfile(
  db: Database,
  participantId: string,
  locale: string,
): Promise<NonNullable<RaceCareer['profile']>> {
  const [p] = await db.execute<{
    name: string;
    short_name: string | null;
    number: number | null;
    birth_date: string | null;
    birth_place: string | null;
    country_code: string | null;
    country_name: Record<string, string> | null;
  }>(sql`
    select p.name, p.short_name, p.number, to_char(p.birth_date, 'YYYY-MM-DD') as birth_date, p.birth_place,
           c.code as country_code, c.name as country_name
      from core.participant p
      left join core.country c on c.code = p.birth_country_code
     where p.id = ${participantId}::uuid`);
  const { first, last } = splitName(p?.name ?? '', p?.short_name ?? null);
  return {
    first_name: first,
    last_name: last,
    number: p?.number == null ? null : Number(p.number),
    birth_date: p?.birth_date ?? null,
    birth_place: p?.birth_place ?? null,
    birth_country: p?.country_code
      ? { code: p.country_code, name: pickText(p.country_name, locale, p.country_code)! }
      : null,
  };
}

/** Temporada corrente da F1: a mais recente com corrida já disputada (em janeiro, ainda a do ano anterior). */
export async function currentF1Season(db: Database): Promise<number | null> {
  const [row] = await db.execute<{ year: number | null }>(sql`
    select max(se.year) as year
      from core.event e
      join core.season se on se.id = e.season_id
      join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race'
     where e.sport = 'formula-1' and e.status = 'finished' and lower(sd.summary->>'type') = 'race'
       and e.starts_at > now() - interval '400 days'`);
  return row?.year == null ? null : Number(row.year);
}

/** Melhor posição e quantas vezes ("1 (x8)"). */
function bestWithCount(positions: number[]): { position: number; count: number } | null {
  if (!positions.length) return null;
  const position = Math.min(...positions);
  return { position, count: positions.filter((p) => p === position).length };
}

/** Pintura curada → contrato (o gradiente sai da primária, como o das cores do escudo). */
export function toLivery(era: ReturnType<typeof liveryFor>): TeamLivery | null {
  const [primary, secondary] = era?.colors ?? [];
  if (!era || !primary) return null;
  return { primary, secondary: secondary ?? null, gradient: teamGradient(primary), source: era.sources[0]! };
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
    top10: 0,
    dnfs: 0,
    sprint: { races: 0, points: 0, wins: 0, podiums: 0, poles: 0, top10: 0 },
    number: null,
    teams: [],
    car: null,
  };
}

export interface RaceCareerOptions {
  /** Pinturas curadas por época (`loadLiveries`), já no piso editorial. */
  liveries?: readonly LiveryEntry[];
}

export async function loadRaceCareer(
  db: Database,
  participant: { id: string; kind: string },
  locale: string,
  assetsBaseUrl: string | undefined,
  options: RaceCareerOptions = {},
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
  const countedSprints = new Set<string>();
  // chegadas e largadas (melhores resultados, "1 (x8)"), números do carro e corridas por equipe em cada ano
  const finishes: number[] = [];
  const grids: number[] = [];
  const numbers = new Map<number, Map<number, number>>();
  const teamRaces = new Map<string, number>();
  for (const r of rows) {
    if (r.year == null) continue;
    const year = Number(r.year);
    const s = season(year);
    const type = (r.type ?? '').toLowerCase();
    const carNumber = num(r.result?.number);
    if (!constructor && carNumber != null) {
      const used = numbers.get(year) ?? new Map<number, number>();
      used.set(carNumber, (used.get(carNumber) ?? 0) + 1);
      numbers.set(year, used);
    }
    if (POLE_SESSIONS.has(type)) {
      if (r.position === 1) s.poles += 1;
      continue;
    }
    if (SPRINT_POLE_SESSIONS.has(type)) {
      if (r.position === 1) s.sprint.poles += 1;
      continue;
    }
    const pos = classifiedAt(r);
    if (type === 'sprint') {
      if (!countedSprints.has(r.event_id)) {
        countedSprints.add(r.event_id);
        s.sprint.races += 1;
      }
      s.sprint.points += num(r.result?.points) ?? sprintPointsAt(year, pos);
      if (pos === 1) s.sprint.wins += 1;
      if (pos != null && pos <= 3) s.sprint.podiums += 1;
      if (pos != null && pos <= 10) s.sprint.top10 += 1;
      continue;
    }
    // equipe: uma corrida conta uma vez; pódios e vitórias somam os pilotos dela
    if (!countedRaces.has(r.event_id)) {
      countedRaces.add(r.event_id);
      s.races += 1;
    }
    if (pos === 1) s.wins += 1;
    if (pos != null && pos <= 3) s.podiums += 1;
    if (pos != null && pos <= 10) s.top10 += 1;
    if (pos != null) finishes.push(pos);
    if (retired(r)) s.dnfs += 1;
    const grid = gridOf(r);
    if (grid != null) grids.push(grid);
    if (fastestBy(r) && !countedFastest.has(r.event_id)) {
      countedFastest.add(r.event_id);
      s.fastest_laps += 1;
    }
    if (constructor)
      addTeam(year, {
        id: r.participant_id,
        name: driverName.get(r.participant_id) ?? '?',
        logo: null,
      });
    else {
      const t = teams.get(teamKey(r) ?? '');
      if (t) {
        addTeam(year, t);
        teamRaces.set(`${year}|${t.id}`, (teamRaces.get(`${year}|${t.id}`) ?? 0) + 1);
      }
    }
  }
  for (const [year, st] of table) {
    const s = season(year);
    s.position = st.rank;
    s.final = st.finished;
    s.points = st.points;
  }
  // a equipe principal do ano primeiro (a de mais corridas), com a pintura daquela época
  for (const [year, m] of seasonTeams)
    season(year).teams = [...m.values()].sort(
      (a, b) => (teamRaces.get(`${year}|${b.id}`) ?? 0) - (teamRaces.get(`${year}|${a.id}`) ?? 0),
    );
  if (!constructor && options.liveries?.length) {
    const liveries = options.liveries;
    const f1dbOf = await f1dbIds(db, [...new Set([...seasonTeams.values()].flatMap((m) => [...m.keys()]))]);
    for (const s of seasons.values())
      s.teams = s.teams.map((t) => {
        const era = (f1dbOf.get(t.id) ?? []).map((id) => liveryFor(liveries, id, s.year)).find(Boolean);
        return { ...t, livery: toLivery(era ?? null) };
      });
  }

  // perfil do piloto (nascimento e número permanente vêm do F1DB) e o número de cada temporada
  const profile = constructor ? null : await driverProfile(db, participant.id, locale);
  if (!constructor)
    for (const s of seasons.values()) {
      const used = [...(numbers.get(s.year) ?? new Map<number, number>()).entries()];
      const top = used.sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
      s.number = top ?? (s.year >= 2014 ? (profile?.number ?? null) : null);
    }

  // fotos: retrato do participante; carro de cada temporada (do construtor; no piloto, das equipes dele)
  const constructorsOf = new Map<number, string[]>();
  for (const [year, s] of seasons)
    constructorsOf.set(year, constructor ? [participant.id] : s.teams.map((t) => t.id));
  const photoOwners = [...new Set([participant.id, ...[...constructorsOf.values()].flat()])];
  const photos = await loadPhotos(db, photoOwners, assetsBaseUrl);
  const portrait = (photos.get(participant.id) ?? []).find((p) => p.role === 'portrait') ?? null;
  const highlightCar = constructor
    ? null
    : ((photos.get(participant.id) ?? []).find((p) => p.role === 'highlight_car') ?? null);
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

  // temporada corrente: o bloco "temporada atual" só para quem correu nela (lenda fica sem)
  const current = await currentF1Season(db);
  const currentRow = current != null ? seasons.get(current) : undefined;
  const competitionId = rows.findLast((r) => r.competition_id)?.competition_id ?? null;
  const [champ] = competitionId
    ? await db.execute<{ id: string; slug: string; name: string }>(
        sql`select id::text, slug, name from core.competition where id = ${competitionId}::uuid`,
      )
    : [];
  const sum = (pick: (s: CareerSeason) => number) => list.reduce((n, s) => n + pick(s), 0);

  return {
    participant_id: participant.id,
    kind: constructor ? 'constructor' : 'driver',
    profile,
    current_season: currentRow && (currentRow.races > 0 || currentRow.sprint.races > 0) ? current : null,
    competition: champ ? { id: champ.id, slug: champ.slug, name: champ.name } : null,
    totals: {
      seasons: list.filter((s) => s.races > 0).length,
      races: sum((s) => s.races),
      wins: sum((s) => s.wins),
      poles: sum((s) => s.poles),
      podiums: sum((s) => s.podiums),
      fastest_laps: sum((s) => s.fastest_laps),
      points: sum((s) => s.points ?? 0),
      titles: titles.length,
      top10: sum((s) => s.top10),
      dnfs: sum((s) => s.dnfs),
      best_finish: bestWithCount(finishes),
      best_grid: bestWithCount(grids),
      sprint: {
        races: sum((s) => s.sprint.races),
        points: sum((s) => s.sprint.points),
        wins: sum((s) => s.sprint.wins),
        podiums: sum((s) => s.sprint.podiums),
        poles: sum((s) => s.sprint.poles),
        top10: sum((s) => s.sprint.top10),
      },
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
    highlight: highlightCar?.season != null ? { season: highlightCar.season, car: highlightCar } : null,
  };
}
