import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

/**
 * Para que serve a conexão; decide os freios do Postgres em cada sessão do pool:
 * - `api`: requisição HTTP (a API pública e a demo). Consulta presa solta a conexão em segundos, antes do
 *   timeout de 30 s da requisição, e o pool de 10 não fica todo preso esperando trava.
 * - `job`: jobs do scheduler e CLIs. Normalização e sync podem ter consultas de minutos; o teto só pega o
 *   que travou de verdade, bem abaixo do tempo limite dos jobs (15 a 120 min).
 * - `live`: o tick do ao vivo (live-run, live-reconcile, events-clock). Escreve placar a cada poucos segundos e
 *   não pode ficar preso numa consulta: 30 s de consulta, bem abaixo do tempo entre ticks no pior caso; a espera
 *   por trava (inclusive o advisory lock do upsert, que um `normalize` em lote pode segurar por alguns segundos) é
 *   mais curta que a dos jobs, mas não tão curta quanto a da API.
 * - `migrate`: sem teto de consulta (índice novo em tabela grande demora), mas desiste rápido de esperar
 *   trava: a migration na fila de um ACCESS EXCLUSIVE faria tudo o que vem depois esperar junto.
 */
export type DbProfile = 'api' | 'job' | 'live' | 'migrate';

/** Tempos em ms; 0 = sem teto (vale o do servidor). */
export interface DbTimeouts {
  /** `statement_timeout`: uma consulta passa disso e é cancelada. */
  statementMs: number;
  /** `lock_timeout`: espera por trava de linha ou tabela passa disso e falha (SQLSTATE 55P03). */
  lockMs: number;
  /** `idle_in_transaction_session_timeout`: transação aberta parada passa disso e a sessão cai. */
  idleInTransactionMs: number;
}

export const DB_TIMEOUTS: Readonly<Record<DbProfile, Readonly<DbTimeouts>>> = {
  api: { statementMs: 10_000, lockMs: 3_000, idleInTransactionMs: 15_000 },
  job: { statementMs: 10 * 60_000, lockMs: 60_000, idleInTransactionMs: 10 * 60_000 },
  live: { statementMs: 30_000, lockMs: 10_000, idleInTransactionMs: 30_000 },
  migrate: { statementMs: 0, lockMs: 5_000, idleInTransactionMs: 0 },
};

/**
 * `max_parallel_workers_per_gather` de cada perfil (null = o do servidor). Jobs e ao vivo rodam sem workers paralelos:
 * numa VPS de 2 vCPU, uma consulta pesada de job com 2 workers ocupava os dois núcleos (17/11/2026, `gameFacts` do
 * related-run) e o ao vivo e a API ficavam esperando CPU. Sem paralelismo a consulta do job demora um pouco mais, mas
 * deixa um núcleo livre. A API e a demo seguem com o do servidor. `DB_MAX_PARALLEL_WORKERS_PER_GATHER` no env troca
 * (ex.: uma CLI pesada rodada à mão fora do horário).
 */
export const DB_PARALLEL_WORKERS: Readonly<Record<DbProfile, number | null>> = {
  api: null,
  job: 0,
  live: 0,
  migrate: null,
};

/** Workers paralelos efetivos de um pool: perfil < env (inteiro ≥ 0; inválido fica o do perfil). */
export function resolveParallelWorkers(
  profile: DbProfile,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.DB_MAX_PARALLEL_WORKERS_PER_GATHER?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : DB_PARALLEL_WORKERS[profile];
}

/** Pool padrão de cada perfil (a soma de todos tem de caber no max_connections; ver infra/vps-telemetry/README.md). */
export const DB_POOL_MAX: Readonly<Record<DbProfile, number>> = { api: 10, job: 4, live: 4, migrate: 1 };

export interface CreateDbOptions {
  /** Máximo de conexões no pool (padrão: o do perfil). */
  max?: number;
  /** Padrão `job`: uma CLI sem perfil ganha o teto longo, nunca o curto da API. */
  profile?: DbProfile;
  /** Nome em pg_stat_activity (quem está segurando conexão ou consulta). */
  applicationName?: string;
  /** Troca algum dos tempos do perfil. */
  timeouts?: Partial<DbTimeouts>;
}

/**
 * Escape para uma CLI pesada rodada à mão (ex.: `-e DB_STATEMENT_TIMEOUT_MS=0` num import grande): o env vale
 * por cima do perfil e das opções. Valor inválido é ignorado (fica o do perfil).
 */
const ENV_TIMEOUTS: Record<keyof DbTimeouts, string> = {
  statementMs: 'DB_STATEMENT_TIMEOUT_MS',
  lockMs: 'DB_LOCK_TIMEOUT_MS',
  idleInTransactionMs: 'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
};

/** Tempos efetivos de um pool: perfil < opções < env. */
export function resolveDbTimeouts(
  profile: DbProfile,
  overrides: Partial<DbTimeouts> = {},
  env: NodeJS.ProcessEnv = process.env,
): DbTimeouts {
  const out: DbTimeouts = { ...DB_TIMEOUTS[profile], ...overrides };
  for (const [field, name] of Object.entries(ENV_TIMEOUTS) as [keyof DbTimeouts, string][]) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) out[field] = n;
  }
  return out;
}

/**
 * Parâmetros de partida da sessão (o Postgres aceita qualquer GUC de sessão no startup; tempo 0 não é enviado).
 * `parallelWorkers` null não é enviado (vale o do servidor).
 */
export function sessionParams(
  timeouts: DbTimeouts,
  applicationName?: string,
  parallelWorkers: number | null = null,
): Record<string, string> {
  const params: Record<string, string> = {};
  if (parallelWorkers !== null) params.max_parallel_workers_per_gather = String(parallelWorkers);
  if (applicationName) params.application_name = applicationName;
  if (timeouts.statementMs > 0) params.statement_timeout = String(timeouts.statementMs);
  if (timeouts.lockMs > 0) params.lock_timeout = String(timeouts.lockMs);
  if (timeouts.idleInTransactionMs > 0)
    params.idle_in_transaction_session_timeout = String(timeouts.idleInTransactionMs);
  return params;
}

export function createDb(url: string, options: CreateDbOptions = {}): Database {
  const profile = options.profile ?? 'job';
  const timeouts = resolveDbTimeouts(profile, options.timeouts);
  const client = postgres(url, {
    max: options.max ?? DB_POOL_MAX[profile],
    onnotice: () => {},
    connection: sessionParams(timeouts, options.applicationName, resolveParallelWorkers(profile)),
  });
  return drizzle(client, { schema }) as Database;
}

export async function closeDb(db: Database): Promise<void> {
  await db.$client.end({ timeout: 5 });
}

/** Verifica conectividade (health checks). */
export async function pingDb(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
