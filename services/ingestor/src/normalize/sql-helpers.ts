import { and, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { providerMap, type Database } from '@galaxie/db';
import { uuidv7 } from './uuid.js';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Remove duplicatas pela chave (a última ocorrência prevalece) — evita "ON CONFLICT ... a second time". */
export function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) map.set(key(item), item);
  return [...map.values()];
}

/**
 * Junta os itens com a mesma chave sem perder campo: o primeiro vence e os nulos dele são preenchidos pelos
 * seguintes (`fill`). Para quando dois IDs do provedor caem na mesma entidade (a mesma equipe com dois nomes
 * no F1DB, IDs reapontados): `dedupeBy` não pega, porque a chave do lote é o ID do provedor.
 */
export function mergeBy<T>(items: readonly T[], key: (item: T) => string, merge: (a: T, b: T) => T): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    const prev = map.get(k);
    map.set(k, prev === undefined ? item : merge(prev, item));
  }
  return [...map.values()];
}

/** `a` com os campos nulos (ou ausentes) preenchidos por `b`. */
export function fillNulls<T extends object>(a: T, b: T): T {
  const out = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) if (out[k] == null && v != null) out[k] = v;
  return out as T;
}

function columnsOf(table: PgTable, keys: readonly string[]): [string, PgColumn][] {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  return keys.map((k) => {
    const col = cols[k];
    if (!col) throw new Error(`coluna ${k} não existe`);
    return [k, col];
  });
}

const excluded = (col: PgColumn) => sql`excluded.${sql.identifier(col.name)}`;

/**
 * SET e WHERE para upsert "coalesce": valores nulos da nova linha não apagam valores conhecidos,
 * e a linha só é tocada (inclusive `updated_at`) quando algo realmente muda. Com `fillOnly`, a nova
 * linha só preenche colunas ainda nulas.
 */
export function coalesceUpdate(
  table: PgTable,
  keys: readonly string[],
  options: { touchUpdatedAt?: boolean; fillOnly?: boolean } = {},
): { set: Record<string, SQL>; setWhere: SQL } {
  const cols = columnsOf(table, keys);
  const set: Record<string, SQL> = {};
  const next: SQL[] = [];
  const current: SQL[] = [];
  for (const [k, col] of cols) {
    // fillOnly: a nova linha só preenche lacunas (referência não sobrescreve o perfil completo)
    const value = options.fillOnly
      ? sql`coalesce(${col}, ${excluded(col)})`
      : sql`coalesce(${excluded(col)}, ${col})`;
    set[k] = value;
    next.push(value);
    current.push(sql`${col}`);
  }
  if (options.touchUpdatedAt) set.updatedAt = sql`now()`;
  return {
    set,
    setWhere: sql`(${sql.join(current, sql`, `)}) is distinct from (${sql.join(next, sql`, `)})`,
  };
}

/** SET e WHERE para upsert que substitui os valores (a nova linha é a verdade). */
export function replaceUpdate(
  table: PgTable,
  keys: readonly string[],
  options: { touchUpdatedAt?: boolean } = {},
): { set: Record<string, SQL>; setWhere: SQL } {
  const cols = columnsOf(table, keys);
  const set: Record<string, SQL> = {};
  for (const [k, col] of cols) set[k] = excluded(col);
  if (options.touchUpdatedAt) set.updatedAt = sql`now()`;
  return {
    set,
    setWhere: sql`(${sql.join(
      cols.map(([, c]) => sql`${c}`),
      sql`, `,
    )}) is distinct from (${sql.join(
      cols.map(([, c]) => excluded(c)),
      sql`, `,
    )})`,
  };
}

export interface ProviderScope {
  provider: string;
  sport: string;
}

/** Resolve IDs do provedor → nossos UUIDs via `core.provider_map`. */
export async function resolveIds(
  db: Executor,
  scope: ProviderScope,
  entityType: string,
  providerIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const chunk of chunks([...new Set(providerIds)], 1000)) {
    const rows = await db
      .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
      .from(providerMap)
      .where(
        and(
          eq(providerMap.provider, scope.provider),
          eq(providerMap.sport, scope.sport),
          eq(providerMap.entityType, entityType),
          inArray(providerMap.providerId, chunk),
        ),
      );
    for (const r of rows) out.set(r.providerId, r.entityId);
  }
  return out;
}

/** Resolve os IDs existentes e reserva UUIDs v7 para os novos (gravados depois com `linkIds`). */
export async function assignIds(
  db: Executor,
  scope: ProviderScope,
  entityType: string,
  providerIds: readonly string[],
): Promise<{ ids: Map<string, string>; created: Set<string> }> {
  const ids = await resolveIds(db, scope, entityType, providerIds);
  const created = new Set<string>();
  for (const pid of providerIds) {
    if (ids.has(pid)) continue;
    ids.set(pid, uuidv7());
    created.add(pid);
  }
  return { ids, created };
}

/** Grava o vínculo provedor → entidade (idempotente). */
export async function linkIds(
  db: Executor,
  scope: ProviderScope,
  entityType: string,
  pairs: readonly { providerId: string; entityId: string }[],
): Promise<void> {
  for (const chunk of chunks(pairs, 1000)) {
    if (!chunk.length) continue;
    await db
      .insert(providerMap)
      .values(chunk.map((p) => ({ entityType, entityId: p.entityId, providerId: p.providerId, ...scope })))
      .onConflictDoNothing();
  }
}
