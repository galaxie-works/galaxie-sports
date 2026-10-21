import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

export interface CreateDbOptions {
  /** Máximo de conexões no pool. */
  max?: number;
}

export function createDb(url: string, options: CreateDbOptions = {}): Database {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  return drizzle(client, { schema }) as Database;
}

export async function closeDb(db: Database): Promise<void> {
  await db.$client.end({ timeout: 5 });
}

/** Verifica conectividade (health checks). */
export async function pingDb(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
