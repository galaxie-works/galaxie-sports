import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDb, createDb } from './client.js';

/** Pasta de migrations versionada no pacote (packages/db/drizzle). */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Aplica todas as migrations pendentes. Idempotente: rodar de novo não altera nada. */
export async function runMigrations(url: string): Promise<void> {
  const db = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await closeDb(db);
  }
}
