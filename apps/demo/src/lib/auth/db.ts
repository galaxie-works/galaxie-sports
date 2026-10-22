/**
 * Conexão do app de demonstração com o Postgres, isolada no schema `demo_auth` (usuários, sessões,
 * convites e atividade). O resto do banco (dados esportivos) é lido só pela API Galaxie Sports.
 */
import { Pool } from 'pg';

export const AUTH_SCHEMA = 'demo_auth';

const connectionString = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;

declare global {
  var __galaxieDemoPool: Pool | undefined;
}

/** Um pool por processo (o dev server recarrega módulos; o global evita vazar conexões). */
export const pool: Pool =
  globalThis.__galaxieDemoPool ??
  new Pool({
    connectionString,
    max: 5,
    options: `-c search_path=${AUTH_SCHEMA}`,
  });
globalThis.__galaxieDemoPool = pool;

export const hasDatabase = Boolean(connectionString);
