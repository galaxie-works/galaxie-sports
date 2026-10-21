import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

/** Conexão ou transação do Drizzle. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type DerbyMatch = {
  id: string;
  slug: string;
  name: string;
  intensity: number;
};

/**
 * Clássico entre dois participantes (core.participant.id), em qualquer ordem — usa
 * semantic.team_profile.participant_id. Se houver mais de um, vence o de maior intensidade.
 */
export async function findDerby(db: Executor, teamAId: string, teamBId: string): Promise<DerbyMatch | null> {
  if (!teamAId || !teamBId || teamAId === teamBId) return null;
  const rows = await db.execute<DerbyMatch>(sql`
    select d.id, d.slug, d.name, d.intensity
      from semantic.derby d
      join semantic.derby_team da on da.derby_id = d.id
      join semantic.team_profile ta on ta.slug = da.team_slug
      join semantic.derby_team db on db.derby_id = d.id and db.team_slug <> da.team_slug
      join semantic.team_profile tb on tb.slug = db.team_slug
     where ta.participant_id = ${teamAId}::uuid and tb.participant_id = ${teamBId}::uuid
     order by d.intensity desc, d.slug
     limit 1`);
  const row = rows[0];
  return row ? { ...row, intensity: Number(row.intensity) } : null;
}

/** Clássico achado pelo par de participantes, no formato do `DerbyLookup` de `@galaxie/providers`. */
export type DerbyPairMatch = {
  derbyId: string;
  slug: string;
  name: string;
  intensity: number;
};

/** Chave do par de participantes, independente da ordem. */
export const participantPairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Todos os clássicos com os dois times ligados ao core (`team_profile.participant_id`), indexados pelo
 * par de participantes. Com mais de um clássico para o mesmo par, fica o de maior intensidade (depois o
 * slug) — o mesmo desempate de `findDerby` e `assignEventDerbies`.
 */
export async function loadDerbyPairs(db: Executor): Promise<Map<string, DerbyPairMatch>> {
  const rows = await db.execute<{
    derby_id: string;
    slug: string;
    name: string;
    intensity: number;
    a: string;
    b: string;
  }>(sql`
    select d.id as derby_id, d.slug, d.name, d.intensity,
           min(tp.participant_id::text) as a, max(tp.participant_id::text) as b
      from semantic.derby d
      join semantic.derby_team dt on dt.derby_id = d.id
      join semantic.team_profile tp on tp.slug = dt.team_slug
     where tp.participant_id is not null
     group by d.id, d.slug, d.name, d.intensity
    having count(*) = 2 and count(distinct tp.participant_id) = 2
     order by d.intensity desc, d.slug`);
  const pairs = new Map<string, DerbyPairMatch>();
  for (const r of rows) {
    const key = participantPairKey(r.a, r.b);
    if (!pairs.has(key))
      pairs.set(key, { derbyId: r.derby_id, slug: r.slug, name: r.name, intensity: Number(r.intensity) });
  }
  return pairs;
}

/**
 * `DerbyLookup` lido do banco (base semântica já semeada): carrega os pares uma única vez, na primeira
 * consulta, e responde em memória. É o gancho do upsert de eventos: o `derby_id` (e a intensidade na
 * importância) sai certo já na gravação do evento.
 */
export function createDerbyLookup(
  db: Executor,
): (participantA: string, participantB: string) => Promise<DerbyPairMatch | null> {
  let pairs: Promise<Map<string, DerbyPairMatch>> | undefined;
  return async (a, b) => {
    if (!a || !b || a === b) return null;
    pairs ??= loadDerbyPairs(db);
    return (await pairs).get(participantPairKey(a, b)) ?? null;
  };
}

/**
 * Preenche (ou limpa) core.event.derby_id a partir dos dois participantes de cada evento.
 * Sem `eventIds`, recalcula todos os eventos (usado pelo seed); com `eventIds`, só esses — é o
 * gancho para o upsert de eventos chamar logo após gravar core.event_participant.
 * Eventos que não têm exatamente dois participantes, ou cujo par não é clássico, ficam com derby_id null.
 */
export async function assignEventDerbies(
  db: Executor,
  options: { eventIds?: string[] } = {},
): Promise<{ updated: number; events: { id: string; derbyId: string | null }[] }> {
  const ids = options.eventIds;
  if (ids && !ids.length) return { updated: 0, events: [] };
  const idList = ids
    ? sql`and e.id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const rows = await db.execute<{ id: string; derby_id: string | null }>(sql`
    with pairs as (
      select ep.event_id, array_agg(ep.participant_id order by ep.participant_id) as p
        from core.event_participant ep
        join core.event e on e.id = ep.event_id
       where true ${idList}
       group by ep.event_id
      having count(*) = 2
    ),
    derby_pairs as (
      select d.id as derby_id, d.intensity, d.slug,
             array_agg(tp.participant_id order by tp.participant_id) as p
        from semantic.derby d
        join semantic.derby_team dt on dt.derby_id = d.id
        join semantic.team_profile tp on tp.slug = dt.team_slug
       where tp.participant_id is not null
       group by d.id, d.intensity, d.slug
      having count(*) = 2
    ),
    matched as (
      select distinct on (pairs.event_id) pairs.event_id, derby_pairs.derby_id
        from pairs
        join derby_pairs on derby_pairs.p = pairs.p
       order by pairs.event_id, derby_pairs.intensity desc, derby_pairs.slug
    ),
    target as (
      select e.id, matched.derby_id
        from core.event e
        left join matched on matched.event_id = e.id
       where true ${idList}
    )
    update core.event e
       set derby_id = target.derby_id, updated_at = now()
      from target
     where target.id = e.id and e.derby_id is distinct from target.derby_id
    returning e.id, e.derby_id`);
  return { updated: rows.length, events: rows.map((r) => ({ id: r.id, derbyId: r.derby_id })) };
}
