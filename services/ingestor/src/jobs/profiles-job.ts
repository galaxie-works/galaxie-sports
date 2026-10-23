import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import { apiSportsPersonId, isCoachPersonId } from '@galaxie/providers';
import { plannedRequest, type JobSpec } from './runtime/runner.js';

export interface ProfileTargets {
  players: number[];
  coaches: number[];
}

/**
 * Pessoas sem foto e sem data de nascimento escaladas desde `since` em competições de tier ≤ `maxTier`
 * (prioridades 1 e 2 da lista de "sem foto"), da mais escalada para a menos. Vêm só das escalações: sem o perfil,
 * não dá para casar com outras fontes de foto (Wikidata) nem mostrar idade e nacionalidade.
 */
export async function profileTargets(
  db: Database,
  options: { since: Date; maxTier: number },
): Promise<ProfileTargets> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`set local max_parallel_workers_per_gather = 0`);
    return tx.execute<{ provider_id: string }>(sql`
      with lu as (
        select p->'player'->>'id' as pid, count(*) as games
        from core.football_fixture f
        join core.event e on e.id = f.event_id
        join core.competition c on c.id = e.competition_id,
          lateral jsonb_array_elements(case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end) l,
          lateral jsonb_array_elements(coalesce(l->'startXI', '[]'::jsonb) || coalesce(l->'substitutes', '[]'::jsonb)) p
        where f.detail is not null and e.starts_at >= ${options.since.toISOString()}::timestamptz and c.tier <= ${options.maxTier}
          and p->'player'->>'id' is not null
        group by 1
        union all
        select 'coach:' || (l->'coach'->>'id'), count(*)
        from core.football_fixture f
        join core.event e on e.id = f.event_id
        join core.competition c on c.id = e.competition_id,
          lateral jsonb_array_elements(case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end) l
        where f.detail is not null and e.starts_at >= ${options.since.toISOString()}::timestamptz and c.tier <= ${options.maxTier}
          and l->'coach'->>'id' is not null
        group by 1
      )
      select m.provider_id
      from lu
      join core.provider_map m on m.provider = 'api-sports' and m.sport = 'football' and m.entity_type = 'person'
        and m.provider_id = lu.pid
      join core.person p on p.id = m.entity_id
      where p.photo_asset_id is null and p.birth_date is null and m.provider_id ~ '^(coach:)?[1-9][0-9]*$'
      order by lu.games desc, m.provider_id
    `);
  });
  const out: ProfileTargets = { players: [], coaches: [] };
  for (const r of rows) {
    const id = Number(apiSportsPersonId(r.provider_id));
    (isCoachPersonId(r.provider_id) ? out.coaches : out.players).push(id);
  }
  return out;
}

/**
 * Perfil (nascimento, nome completo, nacionalidade, altura, peso) de jogadores e técnicos escolhidos:
 * `players/profiles?player=<id>` e `coachs?id=<id>`, uma chamada por pessoa. Prioridade BOOTSTRAP.
 */
export function profilesJob(targets: () => Promise<ProfileTargets>): JobSpec {
  let cached: Promise<ProfileTargets> | undefined;
  const load = () => (cached ??= targets());
  return {
    job: 'bootstrap:perfis',
    priority: 'BOOTSTRAP',
    phases: [
      {
        name: 'perfis de jogadores',
        build: async () =>
          (await load()).players.map((player) =>
            plannedRequest('players-profiles', 'football', '/players/profiles', { player }),
          ),
      },
      {
        name: 'perfis de técnicos',
        build: async () =>
          (await load()).coaches.map((id) => plannedRequest('coachs-id', 'football', '/coachs', { id })),
      },
    ],
  };
}
