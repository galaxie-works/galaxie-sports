/** Fatos da nossa base (F1DB no core) que ancoram a pesquisa da biografia de um piloto. */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import type { DriverFacts } from './propose.js';

export async function driverFacts(db: Database, f1dbIds: string[]): Promise<DriverFacts[]> {
  if (!f1dbIds.length) return [];
  const rows = await db.execute<{
    f1db_id: string;
    name: string;
    code: string | null;
    country: string | null;
    first: number | null;
    last: number | null;
    teams: string[] | null;
    races: string;
    wins: string;
    titles: number[] | null;
  }>(sql`
    with drivers as (
      select replace(pm.provider_id, 'driver-', '') as f1db_id, p.id, p.name, p.code, p.country_code
        from core.provider_map pm
        join core.participant p on p.id = pm.entity_id
       where pm.provider = 'f1db' and pm.sport = 'formula-1' and pm.entity_type = 'participant'
         and pm.provider_id in (${sql.join(
           f1dbIds.map((id) => sql`${`driver-${id}`}`),
           sql`, `,
         )})
    ),
    races as (
      select d.id, se.year, ep.position, ep.result->'team'->>'name' as team
        from drivers d
        join core.event_participant ep on ep.participant_id = d.id
        join core.sport_event_detail sd on sd.event_id = ep.event_id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
        join core.event e on e.id = ep.event_id
        left join core.season se on se.id = e.season_id
    )
    select d.f1db_id, d.name, d.code, d.country_code as country,
           (select min(year) from races r where r.id = d.id) as first,
           (select max(year) from races r where r.id = d.id) as last,
           (select array_agg(distinct team) from races r where r.id = d.id and team is not null) as teams,
           (select count(*) from races r where r.id = d.id) as races,
           (select count(*) from races r where r.id = d.id and r.position = 1) as wins,
           (select array_agg(se.year order by se.year) from core.standing s join core.season se on se.id = s.season_id
             where s.participant_id = d.id and s.group = 'drivers' and s.rank = 1) as titles
      from drivers d`);
  return rows.map((r) => ({
    f1dbId: r.f1db_id,
    name: r.name,
    country: r.country,
    abbreviation: r.code,
    seasons: r.first != null && r.last != null ? { first: Number(r.first), last: Number(r.last) } : null,
    teams: r.teams ?? [],
    titles: (r.titles ?? []).map(Number),
    wins: Number(r.wins),
    races: Number(r.races),
  }));
}
