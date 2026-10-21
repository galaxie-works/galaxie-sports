import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { closeDb, createDb, runMigrations, type Database } from '@galaxie/db';

/** Banco descartável criado a partir de DATABASE_URL (mesmo padrão de packages/db/test). */
export async function createTestDb(): Promise<{ db: Database; drop: () => Promise<void> }> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
  const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  const testUrl = u.toString();
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  const db = createDb(testUrl, { max: 3 });
  return {
    db,
    drop: async () => {
      await closeDb(db);
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    },
  };
}
