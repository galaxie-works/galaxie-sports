import type { CallEvent } from '@galaxie/apisports-client';
import { createLogger, type Logger } from '@galaxie/observability';

/**
 * Logger JSON do ingestor (mesmo formato da API). Quando o processo é disparado pelo scheduler,
 * GALAXIE_SCHEDULER_RUN_ID (`scheduler_run_id`) correlaciona os logs da execução com a linha do scheduler em ops.job_run.
 */
export const logger: Logger = (() => {
  const base = createLogger({ service: 'ingestor' });
  const runId = process.env.GALAXIE_SCHEDULER_RUN_ID;
  return runId ? base.child({ scheduler_run_id: runId }) : base;
})();

/** Observador do ApiSportsClient: uma linha por requisição, com `sport`, `endpoint` e `job_id`. */
export function logProviderCall(log: Logger = logger): (event: CallEvent) => void {
  return (e) => {
    const fields = {
      ...(e.jobId ? { job_id: e.jobId } : {}),
      sport: e.sport,
      endpoint: e.endpoint,
      priority: e.priority,
      source: e.source,
      outcome: e.outcome,
      status_code: e.statusCode,
      quota_remaining: e.quotaRemaining,
      duration_ms: e.durationMs,
    };
    if (e.source === 'cache') log.debug(fields, 'resposta servida do raw (0 cota)');
    else if (e.outcome === 'ok') log.info(fields, 'chamada ao fornecedor');
    else log.warn(fields, 'chamada ao fornecedor com erro');
  };
}

/** Saída de CLI: tabela legível no terminal; JSON estruturado quando roda em container/agendado. */
export function report(msg: string, data: Record<string, unknown> | unknown[], log: Logger = logger): void {
  if (process.stdout.isTTY) {
    console.log(msg);
    if (Array.isArray(data)) console.table(data);
    else console.log(JSON.stringify(data));
  } else {
    log.info(Array.isArray(data) ? { rows: data } : data, msg);
  }
}
