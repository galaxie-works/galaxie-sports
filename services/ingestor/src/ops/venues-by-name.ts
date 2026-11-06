import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

export interface VenuesByNameResult {
  /** Jogos sem estádio cujo nome + cidade da api-sports casa com um só estádio do core. */
  linked: number;
  /** Jogos sem estádio com nome do fornecedor (o universo examinado). */
  candidates: number;
}

/**
 * Liga ao estádio os jogos de futebol já gravados sem `venue_id` em que a api-sports mandou `venue.id` nulo com
 * nome e cidade: mesma regra do upsert (`venuesByName`) — nome e cidade sem caixa, só o casamento único.
 * Idempotente; `dryRun` só conta.
 */
export async function linkEventVenuesByName(
  db: Database,
  opts: { dryRun?: boolean | undefined } = {},
): Promise<VenuesByNameResult> {
  const base = sql`
    with cand as (
      select e.id as event_id,
             lower(trim(ff.summary->'fixture'->'venue'->>'name')) as n,
             lower(trim(coalesce(ff.summary->'fixture'->'venue'->>'city', ''))) as c
        from core.event e
        join core.football_fixture ff on ff.event_id = e.id
       where e.venue_id is null
         and nullif(trim(ff.summary->'fixture'->'venue'->>'name'), '') is not null
    ), v as (
      select lower(trim(name)) as n, lower(trim(coalesce(city, ''))) as c, (array_agg(id))[1] as id, count(*) as k
        from core.venue
       group by 1, 2
    ), hit as (
      select cand.event_id, v.id as venue_id from cand join v on v.n = cand.n and v.c = cand.c and v.k = 1
    )`;
  const [counts] = await db.execute<{ candidates: number; linked: number }>(
    sql`${base} select (select count(*) from cand)::int as candidates, (select count(*) from hit)::int as linked`,
  );
  if (opts.dryRun || !counts?.linked)
    return { linked: counts?.linked ?? 0, candidates: counts?.candidates ?? 0 };
  const updated = await db.execute<{ id: string }>(
    sql`${base} update core.event e set venue_id = hit.venue_id, updated_at = now()
          from hit where e.id = hit.event_id and e.venue_id is null returning e.id`,
  );
  return { linked: updated.length, candidates: counts.candidates };
}
