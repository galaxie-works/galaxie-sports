/**
 * Pacote de hipismo (SQLite) → raw store → tabelas para a normalização.
 *
 * Cada tabela do pacote vira páginas em `raw.api_response` (provider = fonte, endpoint = `sqlite/<tabela>`),
 * identificadas pelo sha256 do arquivo: importar o mesmo pacote de novo não grava nada, e a normalização
 * pode ser refeita só a partir do raw.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, asc, eq, sql } from 'drizzle-orm';
import { apiResponse, type Database } from '@galaxie/db';
import type { PackageTables, Row } from './normalize.js';

/** Tabelas do pacote que alimentam o modelo (as demais ficam fora do raw). */
export const PACKAGE_TABLES = [
  'schema_migrations',
  'athletes',
  'athlete_profiles',
  'participants',
  'championship_participants',
  'horses',
  'horse_ownership_observations',
  'shows',
  'events',
  'competitions',
  'results',
  'result_entities',
  'score_parts',
  'competition_entries',
  'prize_awards',
  'round_details',
  'historical_classifications',
  'championship_classifications',
  'championship_teams',
  'championship_team_members',
  'official_round_observations',
  'jerez_round_observations',
  'jerez_individual_published_summary',
  'jerez_team_published_scores',
  'jerez_team_published_totals',
  'ranking_observations',
  'source_disagreements',
  'jerez_source_disagreements',
] as const;

const PAGE_SIZE = 2000;
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export interface PackageFile {
  sha256: string;
  schemaVersion: number | null;
  tables: PackageTables;
}

/** Lê o SQLite do pacote em modo somente leitura (módulo nativo `node:sqlite`). */
export async function readPackage(path: string): Promise<PackageFile> {
  const { DatabaseSync } = await import('node:sqlite');
  const fileSha = sha256(readFileSync(path));
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const present = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    const tables: PackageTables = {};
    for (const name of PACKAGE_TABLES) {
      if (!present.has(name)) continue;
      tables[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Row[];
    }
    const versions = (tables.schema_migrations ?? []).map((r) => Number(r.version)).filter(Number.isFinite);
    return { sha256: fileSha, schemaVersion: versions.length ? Math.max(...versions) : null, tables };
  } finally {
    db.close();
  }
}

/** Grava as páginas do pacote no raw (idempotente por `request_hash`). Devolve quantas páginas eram novas. */
export async function storePackageRaw(db: Database, source: string, pkg: PackageFile): Promise<number> {
  let inserted = 0;
  for (const [table, list] of Object.entries(pkg.tables)) {
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    for (let page = 1; page <= pages; page++) {
      const params = { package_sha256: pkg.sha256, page };
      const endpoint = `sqlite/${table}`;
      const requestHash = sha256(`${source}|equestrian|${endpoint}|${pkg.sha256}|${page}`);
      const [exists] = await db
        .select({ id: apiResponse.id })
        .from(apiResponse)
        .where(and(eq(apiResponse.provider, source), eq(apiResponse.requestHash, requestHash)))
        .limit(1);
      if (exists) continue;
      const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const body = { table, page, pages, total: list.length, rows: slice };
      const json = JSON.stringify(body);
      await db.insert(apiResponse).values({
        provider: source,
        sport: 'equestrian',
        apiVersion: `package-schema-${pkg.schemaVersion ?? 'unknown'}`,
        endpoint,
        params,
        requestHash,
        page,
        statusCode: 200,
        results: slice.length,
        errors: null,
        body,
        bodyHash: sha256(json),
        jobId: `equestrian-import:${pkg.sha256.slice(0, 12)}`,
      });
      inserted++;
    }
  }
  return inserted;
}

/** Remonta as tabelas de um pacote a partir do raw (para normalizar de novo sem o arquivo). */
export async function loadPackageRaw(
  db: Database,
  source: string,
  packageSha: string,
): Promise<PackageTables> {
  const pages = await db
    .select({ endpoint: apiResponse.endpoint, page: apiResponse.page, body: apiResponse.body })
    .from(apiResponse)
    .where(
      and(
        eq(apiResponse.provider, source),
        eq(apiResponse.sport, 'equestrian'),
        sql`${apiResponse.params}->>'package_sha256' = ${packageSha}`,
      ),
    )
    .orderBy(asc(apiResponse.endpoint), asc(apiResponse.page));
  const tables: PackageTables = {};
  for (const p of pages) {
    const body = p.body as { table: string; rows: Row[] };
    (tables[body.table] ??= []).push(...body.rows);
  }
  return tables;
}
