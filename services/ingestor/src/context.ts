import {
  ApiSportsClient,
  PgQuotaGovernor,
  PgRawStore,
  plansFromEnv,
  PlanRules,
} from '@galaxie/apisports-client';
import { createDb, type Database } from '@galaxie/db';
import { quotaPolicyFromEnv } from '@galaxie/observability';
import { PgCatalogSource, type CatalogSource } from './jobs/catalog-source.js';
import { PgCursorStore } from './jobs/runtime/cursor-store.js';
import { PgJobRunStore } from './jobs/runtime/job-run-store.js';
import { PgRawSource } from './jobs/runtime/raw-source.js';
import type { RunDeps } from './jobs/runtime/runner.js';
import { logger, logProviderCall } from './logger.js';

export interface IngestorContext {
  db: Database;
  client: ApiSportsClient;
  governor: PgQuotaGovernor;
  /** Sem APISPORTS_KEY: o cliente só lê o raw (modo offline) e nunca chama o fornecedor. */
  offline: boolean;
}

/**
 * Monta banco, Governor e cliente a partir das variáveis de ambiente (.env).
 * O plano é por API: APISPORTS_PLAN é o padrão e APISPORTS_PLAN_<ESPORTE> sobrescreve uma API
 * (regras do plano, limite por minuto e política do Quota Governor).
 * Sem APISPORTS_KEY o cliente entra em modo offline: útil depois de restaurar um snapshot do raw.
 */
export function contextFromEnv(env: NodeJS.ProcessEnv = process.env): IngestorContext {
  const { APISPORTS_KEY, DATABASE_URL } = env;
  if (!DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');
  const planFor = plansFromEnv(env);
  const db = createDb(DATABASE_URL);
  const liveTimeoutMs = Number(env.APISPORTS_LIVE_TIMEOUT_MS) || undefined;
  const governor = new PgQuotaGovernor(db, quotaPolicyFromEnv(env));
  const offline = !APISPORTS_KEY;
  const client = new ApiSportsClient({
    apiKey: APISPORTS_KEY ?? '',
    store: new PgRawStore(db),
    governor,
    planFor: (sport) => new PlanRules(planFor(sport)),
    offline,
    // chamada do ao vivo desiste em 30 s (APISPORTS_LIVE_TIMEOUT_MS); as de catálogo seguem com 180 s
    ...(liveTimeoutMs ? { liveTimeoutMs } : {}),
    onCall: logProviderCall(),
    onPlanChange: (rules, sport) =>
      logger.warn(
        { sport, seasons: rules.current.seasons },
        'fornecedor deslocou a janela de temporadas do plano',
      ),
  });
  return { db, client, governor, offline };
}

export interface JobContext extends RunDeps {
  db: Database;
  governor: PgQuotaGovernor;
  catalog: CatalogSource;
  offline: boolean;
}

/** Dependências dos jobs de ingestão (cursores, job_run, raw, catálogo) sobre o Postgres. */
export function jobContextFromEnv(env: NodeJS.ProcessEnv = process.env): JobContext {
  const ctx = contextFromEnv(env);
  return {
    ...ctx,
    cursors: new PgCursorStore(ctx.db),
    runs: new PgJobRunStore(ctx.db),
    raw: new PgRawSource(ctx.db),
    catalog: new PgCatalogSource(ctx.db),
    plan: ctx.client.planRulesFor('football'),
    planFor: (sport) => ctx.client.planRulesFor(sport),
    now: () => new Date(),
  };
}
