import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

export interface SplitCoachesReport {
  /** Ids de técnico da api-sports vistos (escalações, `coachs`, elencos de técnico). */
  coachIds: number;
  /** Pessoas que eram só técnico: o mapeamento passou de `<id>` para `coach:<id>` (a pessoa é a mesma). */
  renamed: number;
  /** Ids usados por um jogador e por um técnico: o técnico ganhou uma pessoa nova (`coach:<id>`). */
  split: number;
  /** Linhas de elenco de técnico levadas da pessoa do jogador para a do técnico. */
  rostersMoved: number;
}

/**
 * Separa técnicos e jogadores que dividiam a mesma `core.person` porque a api-sports usa espaços de ids
 * separados para os dois e o core gravava ambos como `person/<id>`. Depois desta correção o técnico é
 * `person/coach:<id>` (`coachPersonId`).
 *
 * - Pessoa só técnico (nenhum sinal de jogador): o mapeamento muda para `coach:<id>`; o UUID fica o mesmo.
 * - Pessoa que é jogador e técnico: o jogador fica com a pessoa; o técnico ganha uma nova, com o nome visto
 *   nas escalações ou em `coachs`, e leva os elencos de técnico e a foto `coachs/` da antiga.
 *
 * Idempotente: quem já tem `coach:<id>` fica de fora. O perfil completo do técnico chega reprocessando
 * `/coachs`, `/trophies` e `/sidelined` (`normalize:football --tudo --endpoints ...`).
 */
export async function splitCoachIds(db: Database): Promise<SplitCoachesReport> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      create temp table coach_src on commit drop as
      select pid, max(name) as name from (
        select l->'coach'->>'id' as pid, l->'coach'->>'name' as name
        from core.football_fixture f,
          lateral jsonb_array_elements(
            case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end
          ) l
        where f.detail is not null and l->'coach'->>'id' is not null
        union all
        select x->>'id', x->>'name'
        from raw.api_response r,
          lateral jsonb_array_elements(case when jsonb_typeof(r.body->'response') = 'array'
                                            then r.body->'response' else '[]'::jsonb end) x
        where r.provider = 'api-sports' and r.sport = 'football' and r.endpoint = '/coachs' and x->>'id' is not null
        union all
        select m.provider_id, p.name
        from core.roster ro
        join core.person p on p.id = ro.person_id
        join core.provider_map m on m.entity_id = p.id and m.entity_type = 'person'
          and m.provider = 'api-sports' and m.sport = 'football'
        where ro.role = 'coach'
      ) s
      where pid ~ '^[0-9]+$'
      group by pid
    `);
    await tx.execute(sql`
      create temp table lineup_player on commit drop as
      select distinct p->'player'->>'id' as pid
      from core.football_fixture f,
        lateral jsonb_array_elements(
          case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end
        ) l,
        lateral jsonb_array_elements(coalesce(l->'startXI', '[]'::jsonb) || coalesce(l->'substitutes', '[]'::jsonb)) p
      where f.detail is not null and p->'player'->>'id' is not null
    `);
    await tx.execute(sql`
      create temp table coach_fix on commit drop as
      select c.pid, c.name, m.entity_id as person_id,
        (exists (select 1 from lineup_player lp where lp.pid = c.pid)
          or exists (select 1 from core.roster r where r.person_id = m.entity_id and r.role = 'player')
          or exists (select 1 from core.event_incident i where i.person_id = m.entity_id or i.assist_person_id = m.entity_id)
          or exists (select 1 from core.person_season_stat s where s.person_id = m.entity_id)
          or exists (select 1 from core.person_transfer t where t.person_id = m.entity_id)
        ) as player
      from coach_src c
      join core.provider_map m on m.provider = 'api-sports' and m.sport = 'football'
        and m.entity_type = 'person' and m.provider_id = c.pid
      where not exists (
        select 1 from core.provider_map k
        where k.provider = 'api-sports' and k.sport = 'football' and k.entity_type = 'person'
          and k.provider_id = 'coach:' || c.pid
      )
    `);
    const [{ n: coachIds } = { n: 0 }] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from coach_src`,
    );

    const renamed = await tx.execute(sql`
      update core.provider_map m set provider_id = 'coach:' || f.pid
      from coach_fix f
      where not f.player and m.provider = 'api-sports' and m.sport = 'football'
        and m.entity_type = 'person' and m.provider_id = f.pid
      returning m.entity_id
    `);

    await tx.execute(sql`
      create temp table coach_new on commit drop as
      select f.pid, f.person_id as old_id, public.uuid_generate_v7() as new_id,
        coalesce(f.name, (select name from core.person where id = f.person_id)) as name
      from coach_fix f
      where f.player
    `);
    await tx.execute(sql`
      insert into core.person (id, name, photo_asset_id)
      select n.new_id, n.name, case when a.kind = 'coach' then p.photo_asset_id end
      from coach_new n
      join core.person p on p.id = n.old_id
      left join core.asset a on a.id = p.photo_asset_id
    `);
    await tx.execute(sql`
      insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
      select 'person', new_id, 'api-sports', 'football', 'coach:' || pid from coach_new
    `);
    const moved = await tx.execute(sql`
      update core.roster r set person_id = n.new_id
      from coach_new n
      where r.person_id = n.old_id and r.role = 'coach'
      returning r.person_id
    `);
    await tx.execute(sql`
      update core.person p set photo_asset_id = null, updated_at = now()
      from coach_new n, core.asset a
      where p.id = n.old_id and a.id = p.photo_asset_id and a.kind = 'coach'
    `);
    const [{ n: split } = { n: 0 }] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from coach_new`,
    );
    return { coachIds, renamed: renamed.length, split, rostersMoved: moved.length };
  });
}
