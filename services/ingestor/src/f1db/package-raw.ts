/**
 * Release do F1DB (SQLite) → raw store → tabelas para a normalização (mesmo padrão do hipismo).
 *
 * Cada tabela usada (`F1DB_TABLES`) vira páginas em `raw.api_response` (provider `f1db`, endpoint
 * `sqlite/<tabela>`), sem as colunas nulas, identificadas pelo sha256 do arquivo e pela versão do release:
 * importar o mesmo release de novo não grava nada, e a normalização pode ser refeita só a partir do raw.
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { apiResponse, type Database } from '@galaxie/db';
import { F1DB_PROVIDER, F1DB_SPORT, F1DB_TABLES, type F1dbRow, type F1dbTables } from '@galaxie/providers';
import { sha256 } from './release.js';

const PAGE_SIZE = 5000;

/** Linha sem colunas nulas (o `race_data` tem dezenas por tipo de sessão). */
function compactRow(row: Record<string, unknown>): F1dbRow {
  const out: F1dbRow = {};
  for (const [k, v] of Object.entries(row)) if (v != null) out[k] = typeof v === 'bigint' ? Number(v) : v;
  return out;
}

/** sha256 do arquivo em fluxo (o `f1db.db` tem centenas de MB). */
async function fileSha256(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Lê as tabelas do release (`node:sqlite`, somente leitura) e grava as páginas no raw, idempotente por
 * `request_hash`. Em fluxo: só uma página de cada vez na memória (ler o `race_data` inteiro de uma vez estoura o
 * heap do container). Devolve o sha256 do arquivo e quantas páginas eram novas.
 */
export async function storeF1dbRelease(
  db: Database,
  dbPath: string,
  release: string,
): Promise<{ sha256: string; inserted: number }> {
  const { DatabaseSync } = await import('node:sqlite');
  const fileSha = await fileSha256(dbPath);
  const sqlite = new DatabaseSync(dbPath, { readOnly: true });
  let inserted = 0;
  try {
    for (const table of F1DB_TABLES) {
      const { n } = sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number | bigint };
      const total = Number(n);
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const endpoint = `sqlite/${table}`;
      const hashOf = (page: number) =>
        sha256(`${F1DB_PROVIDER}|${F1DB_SPORT}|${endpoint}|${fileSha}|${page}`);
      const missing = new Set<number>();
      for (let page = 1; page <= pages; page++) {
        const [exists] = await db
          .select({ id: apiResponse.id })
          .from(apiResponse)
          .where(and(eq(apiResponse.provider, F1DB_PROVIDER), eq(apiResponse.requestHash, hashOf(page))))
          .limit(1);
        if (!exists) missing.add(page);
      }
      if (!missing.size) continue;
      let page = 1;
      let seen = 0;
      let rows: F1dbRow[] = [];
      const flush = async () => {
        if (missing.has(page)) {
          const body = { table, page, pages, total, rows };
          await db.insert(apiResponse).values({
            provider: F1DB_PROVIDER,
            sport: F1DB_SPORT,
            apiVersion: release,
            endpoint,
            params: { release, package_sha256: fileSha, page },
            requestHash: hashOf(page),
            page,
            statusCode: 200,
            results: rows.length,
            errors: null,
            body,
            bodyHash: sha256(JSON.stringify(body)),
            jobId: `f1db-import:${release}`,
          });
          inserted++;
        }
        page++;
        seen = 0;
        rows = [];
      };
      for (const row of sqlite.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).iterate()) {
        // página que já está no raw: só conta as linhas
        if (missing.has(page)) rows.push(compactRow(row as Record<string, unknown>));
        if (++seen === PAGE_SIZE) await flush();
      }
      if (seen || total === 0) await flush();
    }
  } finally {
    sqlite.close();
  }
  return { sha256: fileSha, inserted };
}

/**
 * Remonta as tabelas de um release a partir do raw (para normalizar de novo sem o arquivo). `fetchedAt` (a
 * primeira gravação do release) é o instante da observação: reimportar o mesmo release não muda nada. As páginas
 * vêm uma a uma, para não ter o release duas vezes na memória (páginas + tabelas).
 */
export async function loadF1dbRaw(
  db: Database,
  packageSha: string,
): Promise<{ release: string | null; fetchedAt: Date | null; tables: F1dbTables }> {
  const pages = await db
    .select({ id: apiResponse.id, version: apiResponse.apiVersion, fetchedAt: apiResponse.fetchedAt })
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
    const [page] = await db
      .select({ body: apiResponse.body })
      .from(apiResponse)
      .where(eq(apiResponse.id, p.id));
    const body = page!.body as { table: keyof F1dbTables; rows: F1dbRow[] };
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
