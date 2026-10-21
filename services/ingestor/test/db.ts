import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { closeDb, createDb, runMigrations, type Database } from '@galaxie/db';

/** Banco descartável por arquivo de teste, criado a partir de DATABASE_URL (ver packages/db/test). */
export function disposableDb(): { setup: () => Promise<Database>; teardown: () => Promise<void> } {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
  const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  const testUrl = u.toString();
  let admin: postgres.Sql | undefined;
  let db: Database | undefined;
  return {
    setup: async () => {
      admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await admin.unsafe(`CREATE DATABASE ${dbName}`);
      await runMigrations(testUrl);
      db = createDb(testUrl, { max: 5 });
      return db;
    },
    teardown: async () => {
      if (db) await closeDb(db);
      if (admin) {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    },
  };
}

/** Envelope da api-sports para respostas falsas. */
export function envelope(get: string, response: unknown, parameters: Record<string, string> = {}): string {
  return JSON.stringify({
    get,
    parameters: Object.keys(parameters).length ? parameters : [],
    errors: [],
    results: Array.isArray(response) ? response.length : 1,
    paging: { current: 1, total: 1 },
    response,
  });
}
