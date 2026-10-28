/**
 * Conexão do app de demonstração com o Postgres, isolada no schema `demo_auth` (usuários, sessões,
 * convites e atividade). O resto do banco (dados esportivos) é lido só pela API Galaxie Sports.
 */
import { Pool } from 'pg';
import { DB_TIMEOUTS } from '@galaxie/db/client';

export const AUTH_SCHEMA = 'demo_auth';

const connectionString = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;

declare global {
  var __galaxieDemoPool: Pool | undefined;
}

function createPool(): Pool {
  const created = new Pool({
    connectionString,
    max: 5,
    options: `-c search_path=${AUTH_SCHEMA}`,
    application_name: 'galaxie-demo-auth',
    // freios de requisição, como na API; a consulta com folga maior, porque o painel de Operação agrega
    // ops.job_run, ops.llm_usage e o conteúdo relacionado (página de admin, fora do caminho da API)
    statement_timeout: 30_000,
    lock_timeout: DB_TIMEOUTS.api.lockMs,
    idle_in_transaction_session_timeout: DB_TIMEOUTS.api.idleInTransactionMs,
  });
  // Uma conexão ociosa encerrada pelo Postgres (restart, failover, pg_terminate_backend, DROP DATABASE
  // ... WITH FORCE: 57P01) é descartada pelo pg-pool, que então emite 'error' no pool. Sem ouvinte, o
  // EventEmitter lança a exceção fora de qualquer requisição (uncaughtException). A próxima consulta
  // abre outra conexão: aqui só registra.
  created.on('error', (err: Error & { code?: string }) => {
    console.warn('[demo-db] conexão ociosa do pool encerrada pelo Postgres', {
      code: err.code,
      err: err.message,
    });
  });
  return created;
}

/** Um pool por processo (o dev server recarrega módulos; o global evita vazar conexões). */
export const pool: Pool = globalThis.__galaxieDemoPool ?? createPool();
globalThis.__galaxieDemoPool = pool;

export const hasDatabase = Boolean(connectionString);
