/**
 * O change feed no Postgres para o seguidor (lib/cache/follower.ts): leitura de `ops.change_feed`,
 * LISTEN `ops_change_feed` (o postgres.js reassina sozinho depois de reconectar) e o cursor salvo em
 * `demo_auth.cache_feed_cursor` (uma linha por consumidor), criado aqui se ainda não existir.
 */
import { CHANGE_FEED_CHANNEL } from '@galaxie/db/change-feed';
import type { Database } from '@galaxie/db/client';

import type { FeedRow, FeedStore, SavedCursor } from './follower';

export function pgFeedStore(db: Database): FeedStore {
  const sql = db.$client;
  let ready: Promise<unknown> | undefined;
  const ensureCursorTable = () => {
    ready ??= (async () => {
      // só cria o schema quando falta: o papel da demo não tem CREATE no banco (packages/db/src/roles.ts)
      const [schema] = await sql`select 1 as ok from pg_namespace where nspname = 'demo_auth'`;
      if (!schema) await sql`create schema if not exists demo_auth`;
      await sql`
        create table if not exists demo_auth.cache_feed_cursor (
          name text primary key,
          last_change_id bigint not null,
          updated_at timestamptz not null default now()
        )`;
    })().catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    return ready;
  };

  return {
    async latestId() {
      const [row] = await sql<{ id: string }[]>`select coalesce(max(id), 0)::text as id from ops.change_feed`;
      return Number(row?.id ?? 0);
    },

    async readAfter(floor, skip, limit) {
      const rows = await sql<{ id: string; entity_type: string; entity_id: string; payload: unknown }[]>`
        select id::text, entity_type, entity_id, payload
          from ops.change_feed
         where id > ${floor} ${skip.length ? sql`and id not in ${sql(skip as number[])}` : sql``}
         order by id
         limit ${limit}`;
      return rows.map<FeedRow>((r) => ({
        id: Number(r.id),
        entityType: r.entity_type,
        entityId: r.entity_id,
        payload: r.payload,
      }));
    },

    async recentIds(latest, maxAgeMs, limit) {
      const rows = await sql<{ id: string }[]>`
        select id::text
          from ops.change_feed
         where id <= ${latest}
           and id >= (select coalesce(min(id), ${latest} + 1)
                        from ops.change_feed
                       where id <= ${latest}
                         and created_at > now() - ${maxAgeMs} * interval '1 millisecond')
         order by id desc
         limit ${limit}`;
      return rows.map((r) => Number(r.id)).reverse();
    },

    async listen(onChange) {
      const sub = await sql.listen(CHANGE_FEED_CHANNEL, () => onChange());
      return () => sub.unlisten();
    },

    async loadCursor(name): Promise<SavedCursor | null> {
      await ensureCursorTable();
      const [row] = await sql<{ last_change_id: string; updated_at: Date }[]>`
        select last_change_id::text, updated_at from demo_auth.cache_feed_cursor where name = ${name}`;
      return row ? { lastId: Number(row.last_change_id), updatedAt: new Date(row.updated_at) } : null;
    },

    async saveCursor(name, lastId) {
      await ensureCursorTable();
      await sql`
        insert into demo_auth.cache_feed_cursor (name, last_change_id, updated_at)
        values (${name}, ${lastId}, now())
        on conflict (name) do update set last_change_id = excluded.last_change_id, updated_at = now()`;
    },
  };
}
