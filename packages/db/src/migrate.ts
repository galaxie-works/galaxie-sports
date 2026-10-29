import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { closeDb, createDb } from './client.js';
import {
  buildConcurrentIndexes,
  readConcurrentIndexes,
  type BuildConcurrentOptions,
  type ConcurrentIndex,
} from './concurrent-indexes.js';
import type { Journal } from './journal.js';

/** Pasta de migrations versionada no pacote (packages/db/drizzle). */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface RunMigrationsOptions {
  /** Tentativas quando a migration desiste de esperar trava (lock_timeout). Padrão 5. */
  attempts?: number;
  /** Espera entre as tentativas (ms). Padrão 10 s. */
  retryDelayMs?: number;
  onRetry?: (attempt: number, err: unknown) => void;
  /** Pasta das migrations (padrão: a do pacote). */
  folder?: string;
  /** Schema da tabela de controle do Drizzle (padrão `drizzle`; os testes usam outro). */
  migrationsSchema?: string;
  /** Índices das migrations `-- galaxie:concurrently` (concurrent-indexes.ts). */
  concurrent?: BuildConcurrentOptions;
}

/** SQLSTATE 55P03 (lock_not_available): o lock_timeout venceu esperando a trava de outra sessão. */
export function isLockTimeout(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; depth++) {
    if ((e as { code?: unknown }).code === '55P03') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** `created_at` (o `when` do journal) da última migration aplicada; null num banco sem migrations. */
async function lastAppliedWhen(url: string, schema: string): Promise<number | null> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [t] = await sql<{ oid: string | null }[]>`
      select to_regclass(${`"${schema}"."__drizzle_migrations"`})::text as oid`;
    if (!t?.oid) return null;
    const [row] = await sql.unsafe<{ when: string | null }[]>(
      `select max(created_at)::text as when from "${schema}"."__drizzle_migrations"`,
    );
    return row?.when == null ? null : Number(row.when);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Cópia da pasta só com as `count` primeiras migrations do journal (para aplicar até antes de uma delas). */
function folderUpTo(folder: string, journal: Journal, count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'galaxie-migrations-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journal.entries.slice(0, count);
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const e of entries) copyFileSync(join(folder, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  return dir;
}

/**
 * Aplica todas as migrations pendentes. Idempotente: rodar de novo não altera nada.
 *
 * O drizzle aplica as pendentes numa transação só: se uma delas esbarra no lock_timeout (um job segurando a
 * tabela), nada fica aplicado pela metade e dá para tentar de novo logo depois. Uma pendente marcada com
 * `-- galaxie:concurrently` divide a aplicação: as anteriores entram, os índices dela são criados com
 * CONCURRENTLY (concurrent-indexes.ts) e só então o resto.
 */
export async function runMigrations(url: string, options: RunMigrationsOptions = {}): Promise<void> {
  const folder = options.folder ?? migrationsFolder;
  const migrationsSchema = options.migrationsSchema ?? 'drizzle';
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal;
  const last = await lastAppliedWhen(url, migrationsSchema);
  // banco vazio: as tabelas nascem na mesma transação, o índice comum é instantâneo
  const marked: { position: number; indexes: ConcurrentIndex[] }[] = [];
  if (last !== null)
    journal.entries.forEach((e, position) => {
      if (e.when <= last) return;
      const indexes = readConcurrentIndexes(join(folder, `${e.tag}.sql`));
      if (indexes) marked.push({ position, indexes });
    });

  for (const { position, indexes } of marked) {
    const partial = folderUpTo(folder, journal, position);
    try {
      await migrateWithRetry(url, partial, migrationsSchema, options);
    } finally {
      rmSync(partial, { recursive: true, force: true });
    }
    await buildConcurrentIndexes(url, indexes, options.concurrent);
  }
  await migrateWithRetry(url, folder, migrationsSchema, options);
}

async function migrateWithRetry(
  url: string,
  folder: string,
  migrationsSchema: string,
  options: RunMigrationsOptions,
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 5);
  for (let attempt = 1; ; attempt++) {
    const db = createDb(url, { profile: 'migrate', applicationName: 'galaxie-migrate' });
    try {
      await migrate(db, { migrationsFolder: folder, migrationsSchema });
      return;
    } catch (err) {
      if (!isLockTimeout(err) || attempt >= attempts) throw err;
      options.onRetry?.(attempt, err);
    } finally {
      await closeDb(db);
    }
    await sleep(options.retryDelayMs ?? 10_000);
  }
}
