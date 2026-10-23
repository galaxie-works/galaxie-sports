/**
 * Release do F1DB (SQLite) → raw store → tabelas para a normalização (mesmo padrão do hipismo).
 *
 * Cada tabela usada (`F1DB_TABLES`) vira páginas em `raw.api_response` (provider `f1db`, endpoint
 * `sqlite/<tabela>`), sem as colunas nulas, identificadas pelo sha256 do arquivo e pela versão do release:
 * importar o mesmo release de novo não grava nada, e a normalização pode ser refeita só a partir do raw.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { apiResponse, type Database } from '@galaxie/db';
import { F1DB_PROVIDER, F1DB_SPORT, F1DB_TABLES, type F1dbRow, type F1dbTables } from '@galaxie/providers';
import { sha256 } from './release.js';

const PAGE_SIZE = 5000;

export interface F1dbPackage {
  sha256: string;
  release: string;
  tables: F1dbTables;
}

/** Linha sem colunas nulas (o `race_data` tem dezenas por tipo de sessão). */
function compactRow(row: Record<string, unknown>): F1dbRow {
  const out: F1dbRow = {};
  for (const [k, v] of Object.entries(row)) if (v != null) out[k] = typeof v === 'bigint' ? Number(v) : v;
  return out;
}

/** Lê as tabelas do release em modo somente leitura (módulo nativo `node:sqlite`). */
export async function readF1dbPackage(dbPath: string, release: string): Promise<F1dbPackage> {
  const { readFileSync } = await import('node:fs');
  const { DatabaseSync } = await import('node:sqlite');
  const fileSha = sha256(readFileSync(dbPath));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables: F1dbTables = {};
    for (const name of F1DB_TABLES)
      tables[name] = (
        db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Record<string, unknown>[]
      ).map(compactRow);
    return { sha256: fileSha, release, tables };
  } finally {
    db.close();
  }
}

/** Grava as páginas no raw (idempotente por `request_hash`). Devolve quantas páginas eram novas. */
export async function storeF1dbRaw(db: Database, pkg: F1dbPackage): Promise<number> {
  let inserted = 0;
  for (const [table, list] of Object.entries(pkg.tables)) {
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    for (let page = 1; page <= pages; page++) {
      const endpoint = `sqlite/${table}`;
      const requestHash = sha256(`${F1DB_PROVIDER}|${F1DB_SPORT}|${endpoint}|${pkg.sha256}|${page}`);
      const [exists] = await db
        .select({ id: apiResponse.id })
        .from(apiResponse)
        .where(and(eq(apiResponse.provider, F1DB_PROVIDER), eq(apiResponse.requestHash, requestHash)))
        .limit(1);
      if (exists) continue;
      const rows = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const body = { table, page, pages, total: list.length, rows };
      await db.insert(apiResponse).values({
        provider: F1DB_PROVIDER,
        sport: F1DB_SPORT,
        apiVersion: pkg.release,
        endpoint,
        params: { release: pkg.release, package_sha256: pkg.sha256, page },
        requestHash,
        page,
        statusCode: 200,
        results: rows.length,
        errors: null,
        body,
        bodyHash: sha256(JSON.stringify(body)),
        jobId: `f1db-import:${pkg.release}`,
      });
      inserted++;
    }
  }
  return inserted;
}

/**
 * Remonta as tabelas de um release a partir do raw (para normalizar de novo sem o arquivo). `fetchedAt` (a
 * primeira gravação do release) é o instante da observação: reimportar o mesmo release não muda nada.
 */
export async function loadF1dbRaw(
  db: Database,
  packageSha: string,
): Promise<{ release: string | null; fetchedAt: Date | null; tables: F1dbTables }> {
  const pages = await db
    .select({ body: apiResponse.body, version: apiResponse.apiVersion, fetchedAt: apiResponse.fetchedAt })
    .from(apiResponse)
    .where(
      and(
        eq(apiResponse.provider, F1DB_PROVIDER),
        eq(apiResponse.sport, F1DB_SPORT),
        sql`${apiResponse.params}->>'package_sha256' = ${packageSha}`,
      ),
    )
    .orderBy(asc(apiResponse.endpoint), asc(apiResponse.page));
  const tables: F1dbTables = {};
  for (const p of pages) {
    const body = p.body as { table: keyof F1dbTables; rows: F1dbRow[] };
    // `constructor` é nome de tabela e também propriedade de todo objeto: só a propriedade própria vale
    const list = Object.hasOwn(tables, body.table) ? tables[body.table]! : (tables[body.table] = []);
    list.push(...body.rows);
  }
  const times = pages.map((p) => p.fetchedAt.getTime());
  return {
    release: pages[0]?.version ?? null,
    fetchedAt: times.length ? new Date(Math.min(...times)) : null,
    tables,
  };
}
