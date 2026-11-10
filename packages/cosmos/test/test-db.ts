/**
 * Banco temporário dos testes de integração da Cosmos. Um pool por arquivo, pequeno, fechado no fim; a conexão de
 * administração só abre para criar e para apagar o banco. No CI o Postgres tem max_connections=100 e as suítes de
 * vários pacotes rodam em paralelo: cada conexão que um arquivo segura falta para os outros.
 */
import { randomBytes } from 'node:crypto';
import { closeDb, createDb, runMigrations, type Database } from '@galaxie/db';
import postgres from 'postgres';

/** Conexões por arquivo: os testes de concorrência ainda intercalam chamadas entre elas. */
export const TEST_POOL_MAX = 3;

export interface TempDb {
  db: Database;
  close(): Promise<void>;
}

async function asAdmin(adminUrl: string, statement: string) {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end();
  }
}

export async function createTempDb(options: { max?: number } = {}): Promise<TempDb> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
  const name = `galaxie_test_${randomBytes(4).toString('hex')}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await asAdmin(adminUrl, `CREATE DATABASE ${name}`);
  await runMigrations(url.toString());
  const db = createDb(url.toString(), { max: options.max ?? TEST_POOL_MAX });
  return {
    db,
    async close() {
      await closeDb(db);
      await asAdmin(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
}
