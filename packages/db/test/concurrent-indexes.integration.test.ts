/**
 * Migration `-- galaxie:concurrently`: num banco que já tem as anteriores, o índice sai com CONCURRENTLY, fora
 * da transação do migrator, sem bloquear a escrita; num banco vazio, o próprio arquivo cria o índice.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';
import type { ConcurrentIndex } from '../src/concurrent-indexes.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const tag = randomBytes(4).toString('hex');
const schema = `ci_${tag}`;
const migrationsSchema = `ci_${tag}_drizzle`;
let sql: postgres.Sql;
const dirs: string[] = [];

/** Pasta de migrations com as `files` dadas (tag → SQL), na ordem. */
function folder(files: [string, string][]): string {
  const dir = mkdtempSync(join(tmpdir(), 'galaxie-ci-test-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'meta'));
  const entries = files.map(([t], idx) => ({
    idx,
    version: '7',
    when: 1_000 + idx,
    tag: t,
    breakpoints: true,
  }));
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  );
  for (const [t, text] of files) writeFileSync(join(dir, `${t}.sql`), text);
  return dir;
}

const M0: [string, string] = [
  '0000_tabela',
  `CREATE SCHEMA "${schema}";--> statement-breakpoint
CREATE TABLE "${schema}"."t" ("id" int PRIMARY KEY, "k" int, "u" int);--> statement-breakpoint
INSERT INTO "${schema}"."t" SELECT g, g % 7, g FROM generate_series(1, 5000) g;`,
];
const M1: [string, string] = [
  '0001_indices',
  `-- galaxie:concurrently
CREATE INDEX IF NOT EXISTS "t_k_idx" ON "${schema}"."t" USING btree ("k");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "t_u_uq" ON "${schema}"."t" USING btree ("u");`,
];

const indexState = async (name: string) =>
  (
    await sql<{ valid: boolean }[]>`
      select i.indisvalid as valid from pg_class c join pg_namespace n on n.oid = c.relnamespace
        join pg_index i on i.indexrelid = c.oid where n.nspname = ${schema} and c.relname = ${name}`
  )[0];

beforeAll(() => {
  sql = postgres(url, { max: 2, onnotice: () => {} });
});

afterAll(async () => {
  await sql.unsafe(`drop schema if exists "${schema}" cascade`);
  await sql.unsafe(`drop schema if exists "${migrationsSchema}" cascade`);
  await sql.end();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('runMigrations com migration de índices concorrentes', () => {
  it('banco com as anteriores: cria com CONCURRENTLY antes de aplicar o arquivo e limpa índice inválido', async () => {
    await runMigrations(url, { folder: folder([M0]), migrationsSchema });

    // sobra de um CONCURRENTLY interrompido: índice único inválido (duplicata no meio da construção)
    await sql.unsafe(`update "${schema}"."t" set u = 1 where id = 2`);
    await expect(
      sql.unsafe(`create unique index concurrently "t_u_uq" on "${schema}"."t" ("u")`),
    ).rejects.toThrow();
    expect(await indexState('t_u_uq')).toEqual({ valid: false });
    await sql.unsafe(`update "${schema}"."t" set u = 2 where id = 2`);

    const seen: [string, string][] = [];
    await runMigrations(url, {
      folder: folder([M0, M1]),
      migrationsSchema,
      concurrent: { onIndex: (i: ConcurrentIndex, outcome) => seen.push([i.name, outcome]) },
    });
    expect(seen).toEqual([
      ['t_k_idx', 'created'],
      ['t_u_uq', 'created'],
    ]);
    expect(await indexState('t_k_idx')).toEqual({ valid: true });
    expect(await indexState('t_u_uq')).toEqual({ valid: true });
    const applied = await sql.unsafe(
      `select count(*)::int as n from "${migrationsSchema}"."__drizzle_migrations"`,
    );
    expect(applied[0]!.n).toBe(2);

    // de novo: nada pendente, nada a construir
    seen.length = 0;
    await runMigrations(url, {
      folder: folder([M0, M1]),
      migrationsSchema,
      concurrent: { onIndex: (i, outcome) => seen.push([i.name, outcome]) },
    });
    expect(seen).toEqual([]);
  });

  it('falha na construção para o migrate e deixa a migration pendente (sem índice inválido)', async () => {
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.unsafe(`drop schema if exists "${migrationsSchema}" cascade`);
    await runMigrations(url, { folder: folder([M0]), migrationsSchema });
    await sql.unsafe(`update "${schema}"."t" set u = 1 where id = 2`); // o índice único não fecha
    await expect(runMigrations(url, { folder: folder([M0, M1]), migrationsSchema })).rejects.toThrow();
    expect(await indexState('t_u_uq')).toBeUndefined();
    const applied = await sql.unsafe(
      `select count(*)::int as n from "${migrationsSchema}"."__drizzle_migrations"`,
    );
    expect(applied[0]!.n).toBe(1);
  });

  it('banco vazio: o próprio arquivo cria os índices (sem passo concorrente)', async () => {
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    await sql.unsafe(`drop schema if exists "${migrationsSchema}" cascade`);
    const seen: string[] = [];
    await runMigrations(url, {
      folder: folder([M0, M1]),
      migrationsSchema,
      concurrent: { onIndex: (i) => seen.push(i.name) },
    });
    expect(seen).toEqual([]);
    expect(await indexState('t_k_idx')).toEqual({ valid: true });
  });
});
