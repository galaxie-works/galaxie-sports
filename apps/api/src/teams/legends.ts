/**
 * Lendas da Fórmula 1 (o carrossel "Legendary"), calculadas do core (F1DB + api-sports) com o mesmo critério do
 * escopo `lendas` do acervo da Commons (docs/runbooks/fotos-commons.md): todos os campeões mundiais (título de
 * temporada encerrada) e os 20 pilotos com mais vitórias e com mais GPs.
 *
 * - Ordem: títulos, depois vitórias, GPs disputados e o nome. Objetiva e a mesma para todo cliente e idioma; um
 *   campeão novo entra sozinho no fim da temporada.
 * - GPs, vitórias e pódios contam como em `/v1/teams/{id}/career` (sessão `Race`, uma vez por corrida, vitória e
 *   pódio só com chegada numérica): o card e a página do piloto mostram os mesmos números.
 * - Temporada marcante: a do carro de destaque do acervo (`highlight_car`, curadoria) ou, sem ele, a de título com
 *   mais vitórias (sem título, a de mais vitórias; empate, a mais recente), de preferência uma com foto do carro.
 * - O fundo nunca é CC BY-SA: o card recorta a foto (cover), o que é uma adaptação. Sem foto compatível, `car`
 *   fica null e o card usa a cor da equipe e o número.
 */
import { sql } from 'drizzle-orm';
import type { Photo, RaceLegend } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import { liveryFor, type LiveryEntry } from '@galaxie/knowledge';
import { loadRaceTeams } from '../events/race.js';
import { pickText } from '../i18n.js';
import { currentF1Season, f1dbIds, splitName, toLivery } from './career.js';
import { loadPhotos } from './photos.js';

/** Quantos pilotos entram por vitórias e por GPs (o `--limite` padrão do escopo `lendas`). */
export const LEGEND_TOP = 20;

/** Vitória e pódio só com chegada numérica (abandono ordenado pela api-sports vem com `time: "DNF"`). */
const CLASSIFIED = sql`coalesce(ep.result->>'position_text', '1') ~ '^[0-9]+$' and coalesce(ep.result->>'time', '') <> 'DNF'`;

/** Corridas (`Race`) encerradas da F1, com o participante, o ano e o resultado. */
const RACES = sql`
  core.event_participant ep
  join core.event e on e.id = ep.event_id and e.sport = 'formula-1' and e.status = 'finished'
  join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
  join core.season se on se.id = e.season_id`;

export interface DriverTotals {
  id: string;
  name: string;
  titles: number[];
  wins: number;
  races: number;
}

/**
 * Quem é lenda e em que ordem: os campeões e os `top` com mais vitórias e com mais GPs (empate na linha de corte:
 * o nome), por títulos, vitórias, GPs e nome. Puro.
 */
export function rankLegends<T extends DriverTotals>(
  drivers: readonly T[],
  top = LEGEND_TOP,
): (T & { criteria: RaceLegend['criteria'] })[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'en');
  const topBy = (pick: (d: T) => number) =>
    new Set(
      drivers
        .filter((d) => pick(d) > 0)
        .sort((a, b) => pick(b) - pick(a) || byName(a, b))
        .slice(0, top)
        .map((d) => d.id),
    );
  const wins = topBy((d) => d.wins);
  const races = topBy((d) => d.races);
  return drivers
    .map((d) => ({
      ...d,
      criteria: [
        ...(d.titles.length ? (['titles'] as const) : []),
        ...(wins.has(d.id) ? (['wins'] as const) : []),
        ...(races.has(d.id) ? (['races'] as const) : []),
      ],
    }))
    .filter((d) => d.criteria.length > 0)
    .sort(
      (a, b) => b.titles.length - a.titles.length || b.wins - a.wins || b.races - a.races || byName(a, b),
    );
}

export interface LegendSeason {
  year: number;
  title: boolean;
  wins: number;
  /** Foto do carro da temporada que pode ir ao fundo (sem CC BY-SA), quando houver. */
  car: Photo | null;
}

/** Foto que pode ir ao fundo do card (recortada no navegador): CC BY, CC0 e domínio público; nunca CC BY-SA. */
export const coverable = (photo: Photo | null | undefined): photo is Photo =>
  !!photo?.url && !photo.credit.share_alike;

/**
 * Temporada marcante e o carro do fundo. O carro de destaque do acervo vence (curadoria); sem ele, título com mais
 * vitórias → mais vitórias → a mais recente, de preferência uma com foto do carro; sem foto em nenhuma, a mais
 * marcante, sem carro. Puro.
 */
export function pickHighlight<S extends LegendSeason>(
  seasons: readonly S[],
  highlightCar: Photo | null,
): { season: S; car: Photo | null } | null {
  if (coverable(highlightCar)) {
    const season = seasons.find((s) => s.year === highlightCar.season);
    if (season) return { season, car: highlightCar };
  }
  const ranked = [...seasons].sort(
    (a, b) => Number(b.title) - Number(a.title) || b.wins - a.wins || b.year - a.year,
  );
  const withCar = ranked.find((s) => coverable(s.car));
  if (withCar) return { season: withCar, car: withCar.car };
  return ranked[0] ? { season: ranked[0], car: null } : null;
}

export interface RaceLegendsOptions {
  /** Pinturas curadas por época (`loadLiveries`), já no piso editorial. */
  liveries?: readonly LiveryEntry[];
  /** Quantas lendas devolver (padrão: todas). */
  limit?: number | undefined;
}

export async function loadRaceLegends(
  db: Database,
  locale: string,
  assetsBaseUrl: string | undefined,
  options: RaceLegendsOptions = {},
): Promise<RaceLegend[]> {
  // totais de todos os pilotos: uma passada pelas corridas da história
  const totals = await db.execute<{
    id: string;
    name: string;
    short_name: string | null;
    number: number | null;
    country_code: string | null;
    country_name: Record<string, string> | null;
    races: string;
    wins: string;
    podiums: string;
    from_year: number;
    to_year: number;
  }>(sql`
    select p.id::text, p.name, p.short_name, p.number, c.code as country_code, c.name as country_name,
           count(distinct ep.event_id) as races,
           count(distinct ep.event_id) filter (where ep.position = 1 and ${CLASSIFIED}) as wins,
           count(distinct ep.event_id) filter (where ep.position <= 3 and ${CLASSIFIED}) as podiums,
           min(se.year) as from_year, max(se.year) as to_year
      from ${RACES}
      join core.participant p on p.id = ep.participant_id and p.kind = 'driver'
      left join core.country c on c.code = coalesce(p.country_code, p.birth_country_code)
     group by p.id, c.code`);
  // títulos: 1º no campeonato de pilotos de temporada encerrada (ano anterior ao atual ou já passado o último GP)
  const champions = await db.execute<{ participant_id: string; year: number }>(sql`
    select s.participant_id::text, se.year
      from core.standing s
      join core.season se on se.id = s.season_id
      join core.competition c on c.id = se.competition_id and c.sport = 'formula-1'
     where s.group = 'drivers' and s.rank = 1
       and (se.year < extract(year from now())::int
            or ((se.end_date is null or se.end_date < current_date)
                and exists (select 1 from core.event e
                          join core.sport_event_detail sd on sd.event_id = e.id
                         where e.season_id = se.id and lower(sd.summary->>'type') = 'race')
                and not exists (select 1 from core.event e
                                  join core.sport_event_detail sd on sd.event_id = e.id
                                 where e.season_id = se.id and lower(sd.summary->>'type') = 'race'
                                   and e.starts_at > now() - interval '3 hours')))`);
  const titlesOf = new Map<string, number[]>();
  for (const r of champions)
    titlesOf.set(r.participant_id, [...(titlesOf.get(r.participant_id) ?? []), Number(r.year)]);

  const ranked = rankLegends(
    totals.map((t) => ({
      ...t,
      titles: [...new Set(titlesOf.get(t.id) ?? [])].sort((a, b) => a - b),
      wins: Number(t.wins),
      races: Number(t.races),
    })),
  ).slice(0, options.limit ?? Infinity);
  if (!ranked.length) return [];
  const ids = ranked.map((l) => l.id);

  // temporada a temporada das lendas: vitórias, equipe (a de mais corridas) e número (o mais usado)
  const rows = await db.execute<{
    participant_id: string;
    year: number;
    team_key: string | null;
    number: string | null;
    races: string;
    wins: string;
  }>(sql`
    select ep.participant_id::text, se.year, ep.result->'team'->>'id' as team_key, ep.result->>'number' as number,
           count(distinct ep.event_id) as races,
           count(distinct ep.event_id) filter (where ep.position = 1 and ${CLASSIFIED}) as wins
      from ${RACES}
     where ep.participant_id in (${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})
     group by 1, 2, 3, 4`);
  type Season = { year: number; wins: number; teams: Map<string, number>; numbers: Map<number, number> };
  const seasonsOf = new Map<string, Map<number, Season>>();
  for (const r of rows) {
    const year = Number(r.year);
    const byYear = seasonsOf.get(r.participant_id) ?? new Map<number, Season>();
    const s = byYear.get(year) ?? { year, wins: 0, teams: new Map(), numbers: new Map() };
    const races = Number(r.races);
    s.wins += Number(r.wins);
    if (r.team_key) s.teams.set(r.team_key, (s.teams.get(r.team_key) ?? 0) + races);
    const n = r.number == null ? NaN : Number(r.number);
    if (Number.isInteger(n)) s.numbers.set(n, (s.numbers.get(n) ?? 0) + races);
    byYear.set(year, s);
    seasonsOf.set(r.participant_id, byYear);
  }
  const top = <K>(m: Map<K, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;

  const teams = await loadRaceTeams(
    db,
    'formula-1',
    rows.map((r) => ({ team: { id: r.team_key } })),
    assetsBaseUrl,
  );
  const teamIds = [...new Set([...teams.values()].map((t) => t.id))];
  const photos = await loadPhotos(db, [...ids, ...teamIds], assetsBaseUrl);
  const f1dbOf = options.liveries?.length ? await f1dbIds(db, teamIds) : new Map<string, string[]>();
  const current = await currentF1Season(db);

  return ranked.map((l) => {
    const own = photos.get(l.id) ?? [];
    const titles = new Set(l.titles);
    const seasons = [...(seasonsOf.get(l.id)?.values() ?? [])].map((s) => {
      const key = top(s.teams);
      const team = key == null ? null : (teams.get(key) ?? null);
      const car =
        (team ? (photos.get(team.id) ?? []) : []).find(
          (p) => p.role === 'car' && p.season === s.year && coverable(p),
        ) ?? null;
      return { year: s.year, title: titles.has(s.year), wins: s.wins, car, team, number: top(s.numbers) };
    });
    const picked = pickHighlight(seasons, own.find((p) => p.role === 'highlight_car') ?? null);
    const team = picked?.season.team ?? null;
    const f1db = team ? (f1dbOf.get(team.id) ?? []) : [];
    const era = f1db.map((id) => liveryFor(options.liveries ?? [], id, picked!.season.year)).find(Boolean);
    // o nome do construtor na curadoria (o do F1DB), sem o patrocinador de hoje
    const curated = options.liveries?.find((entry) => f1db.includes(entry.slug))?.name;
    const permanent = l.number == null ? null : Number(l.number);
    const { first, last } = splitName(l.name, l.short_name);
    return {
      id: l.id,
      name: l.name,
      first_name: first,
      last_name: last,
      country: l.country_code
        ? { code: l.country_code, name: pickText(l.country_name, locale, l.country_code)! }
        : null,
      titles: l.titles,
      wins: l.wins,
      races: l.races,
      podiums: Number(l.podiums),
      seasons: { from: Number(l.from_year), to: Number(l.to_year) },
      active: current != null && seasonsOf.get(l.id)?.has(current) === true,
      criteria: l.criteria,
      highlight: picked
        ? {
            season: picked.season.year,
            team: team
              ? { ...team, constructor_name: curated ?? team.name, livery: toLivery(era ?? null) }
              : null,
            number: picked.season.number ?? (picked.season.year >= 2014 ? permanent : null),
            car: picked.car,
          }
        : null,
      portrait: own.find((p) => p.role === 'portrait') ?? null,
    };
  });
}
