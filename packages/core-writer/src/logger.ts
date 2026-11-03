import { createLogger, type Logger } from '@galaxie/observability';

/**
 * Logger JSON do gravador do core (mesmo formato do ingestor e da API). Quando o processo é disparado pelo
 * scheduler, GALAXIE_SCHEDULER_RUN_ID (`scheduler_run_id`) correlaciona o log com a linha de ops.job_run.
 */
export const logger: Logger = (() => {
  const base = createLogger({ service: 'core-writer' });
  const runId = process.env.GALAXIE_SCHEDULER_RUN_ID;
  return runId ? base.child({ scheduler_run_id: runId }) : base;
})();
