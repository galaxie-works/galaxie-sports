/**
 * QUEUE_MODE: o scheduler executa o job (`run`, o padrão, como sempre foi) ou só enfileira a tarefa equivalente na
 * fila (`enqueue`), para o worker (#542) executar. Vale só para os jobs com `task` na definição; os outros rodam como
 * hoje nos dois modos. Enfileirar usa `dedupe_key` = `<job>:<dia UTC>`: enquanto a tarefa do dia estiver pendente ou
 * rodando, o horário seguinte, o catch-up ou o "rodar agora" do painel não criam outra.
 */
import { enqueue } from '@galaxie/db/queue';
import { parseParams, taskType, TASK_TYPES, type TaskRegistry } from '@galaxie/db/queue-types';
import type { Database } from '@galaxie/db';
import type { Logger } from '@galaxie/observability';
import type { RunRecorder, RunResult, RunTrigger } from './runner.js';
import type { ScheduledJob } from './schedule.js';

export type QueueMode = 'run' | 'enqueue';

/** `QUEUE_MODE=enqueue` liga o modo fila; qualquer outro valor (ou nenhum) é `run`. */
export function queueMode(env: NodeJS.ProcessEnv): QueueMode {
  return env.QUEUE_MODE?.trim().toLowerCase() === 'enqueue' ? 'enqueue' : 'run';
}

/** Uma tarefa viva por job e dia (UTC). */
export function queueDedupeKey(job: Pick<ScheduledJob, 'name'>, now: Date): string {
  return `${job.name}:${now.toISOString().slice(0, 10)}`;
}

export interface EnqueueJobOptions {
  trigger: RunTrigger;
  recorder?: RunRecorder | undefined;
  logger: Logger;
  now?: Date;
  registry?: TaskRegistry;
}

/**
 * Enfileira a tarefa do job em vez de rodar o CLI. A execução fica em ops.job_run como `ok` com o id da tarefa nas
 * estatísticas; tipo desconhecido, params que não conferem ou tipo destrutivo (que só entra por prévia e aprovação)
 * fecham em erro, sem enfileirar.
 */
export async function enqueueJob(
  db: Database,
  job: ScheduledJob,
  options: EnqueueJobOptions,
): Promise<RunResult> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const runId = await options.recorder?.start(job.name).catch(() => undefined);
  const done = async (
    status: 'ok' | 'error',
    error: string | null,
    stats: Record<string, unknown>,
  ): Promise<RunResult> => {
    if (runId) await options.recorder?.finish(runId, status, error, { ...stats, trigger: options.trigger });
    return {
      job: job.name,
      runId,
      status,
      exitCode: status === 'ok' ? 0 : 1,
      signal: null,
      timedOut: false,
      durationMs: Date.now() - started,
    };
  };
  const task = job.task!;
  const def = taskType(task.type, options.registry ?? TASK_TYPES);
  const refused = !def
    ? `tipo de tarefa desconhecido: ${task.type}`
    : def.destrutiva
      ? `${task.type} é destrutiva: só entra na fila por prévia e aprovação`
      : null;
  const parsed = def && !refused ? parseParams(def, task.params ?? {}) : undefined;
  const error = refused ?? (parsed && !parsed.ok ? `params inválidos: ${parsed.issues.join('; ')}` : null);
  if (error || !parsed?.ok) {
    options.logger.error({ job: job.name, type: task.type, error }, 'tarefa do job não enfileirada');
    return done('error', error ?? 'params inválidos', { queueMode: 'enqueue' });
  }
  const dedupeKey = queueDedupeKey(job, now);
  const r = await enqueue(db, {
    type: task.type,
    params: parsed.value,
    dedupeKey,
    ...(def!.maxAttempts ? { maxAttempts: def!.maxAttempts } : {}),
    ...(task.priority !== undefined ? { priority: task.priority } : {}),
    requestedBy: `scheduler:${job.name}`,
  });
  options.logger.info(
    { job: job.name, type: task.type, task: r.id, created: r.created, dedupeKey, trigger: options.trigger },
    r.created ? 'tarefa enfileirada' : 'tarefa do dia já na fila; nada enfileirado',
  );
  return done('ok', null, { queueMode: 'enqueue', tarefa: r.id, nova: r.created, dedupeKey });
}
