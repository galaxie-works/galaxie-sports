/**
 * Alvos do acervo de fotos a partir do F1DB gravado no raw (último release com as tabelas de equipes e chassis):
 * pilotos e carros de um escopo, ou os alvos que já estão no manifesto. Só as tabelas que os alvos usam (sem o
 * `race_data`, a maior do release): cabe no container de 512 MB.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { apiResponse, type Database } from '@galaxie/db';
import { F1DB_PROVIDER, rowsOf, type F1dbRow, type F1dbTableName, type F1dbTables } from '@galaxie/providers';
import { COMMONS_SCOPES, mergeCarTarget, targetKey, targetsFor, type CommonsTarget } from './scope.js';

const TABLES: readonly F1dbTableName[] = [
  'driver',
  'constructor',
  'chassis',
  'season_driver',
  'season_driver_standing',
  'season_entrant_driver',
  'season_entrant_chassis',
];

export async function loadF1dbForCommons(
  db: Database,
): Promise<{ tables: F1dbTables; release: string | null }> {
  const [latest] = await db.execute<{ sha: string; release: string | null }>(sql`
    select params->>'package_sha256' as sha, api_version as release from raw.api_response
     where provider = 'f1db' and endpoint = 'sqlite/season_entrant_chassis'
     order by fetched_at desc limit 1`);
  if (!latest)
    throw new Error('F1DB sem as tabelas de equipes e chassis no raw: rode f1db:import (ou --previa) antes.');
  const pages = await db
    .select({ body: apiResponse.body })
    .from(apiResponse)
    .where(
      and(
        eq(apiResponse.provider, F1DB_PROVIDER),
        sql`${apiResponse.params}->>'package_sha256' = ${latest.sha}`,
        inArray(
          apiResponse.endpoint,
          TABLES.map((t) => `sqlite/${t}`),
        ),
      ),
    )
    .orderBy(asc(apiResponse.endpoint), asc(apiResponse.page));
  const tables: F1dbTables = {};
  for (const p of pages) {
    const body = p.body as { table: F1dbTableName; rows: F1dbRow[] };
    // `constructor` é nome de tabela e também propriedade de todo objeto: só a propriedade própria vale
    const list = Object.hasOwn(tables, body.table) ? tables[body.table]! : (tables[body.table] = []);
    list.push(...body.rows);
  }
  if (!rowsOf(tables, 'chassis').length) throw new Error('F1DB do raw sem a tabela chassis.');
  return { tables, release: latest.release };
}

/**
 * Alvos pelas chaves (`driver/<id>`, `car/<construtor>/<ano>`), procurados em todos os escopos. O carro que é
 * destaque de pilotos em escopos diferentes leva os pilotos de todos (`mergeCarTarget`).
 */
export function targetsByKey(tables: F1dbTables, keys: readonly string[]): CommonsTarget[] {
  const wanted = new Set(keys);
  const found = new Map<string, CommonsTarget>();
  for (const scope of COMMONS_SCOPES)
    for (const t of targetsFor(tables, scope, 10_000)) {
      const key = targetKey(t);
      if (!wanted.has(key)) continue;
      const prev = found.get(key);
      if (prev) mergeCarTarget(prev, t);
      else found.set(key, t);
    }
  return keys.flatMap((k) => found.get(k) ?? []);
}
