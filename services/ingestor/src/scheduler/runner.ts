import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { jobRun, type Database } from '@galaxie/db';
import type { Logger } from '@galaxie/observability';
import type { ScheduledJob } from './schedule.js';

/** Onde o scheduler registra cada execução (ops.job_run alimenta as métricas e o alerta "job falhando 3×"). */
export interface RunRecorder {
  start(job: string): Promise<string>;
  finish(
    id: string,
    status: 'ok' | 'error',
    error: string | null,
    stats: Record<string, unknown>,
  ): Promise<void>;
}

export class PgRunRecorder implements RunRecorder {
  constructor(private readonly db: Database) {}

  async start(job: string): Promise<string> {
    const [row] = await this.db
      .insert(jobRun)
      .values({ job, status: 'running' })
      .returning({ id: jobRun.id });
    return row!.id;
  }

  async finish(
    id: string,
    status: 'ok' | 'error',
    error: string | null,
    stats: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(jobRun)
      .set({ status, error, stats, finishedAt: new Date() })
      .where(eq(jobRun.id, id));
  }
}

export interface RunOptions {
  /** Raiz do pacote do ingestor (onde fica dist/). Os CLIs resolvem caminhos relativos a ela. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  recorder?: RunRecorder | undefined;
  logger: Logger;
  trigger: 'schedule' | 'manual' | 'start';
  /** Tempo para o processo encerrar depois do SIGTERM antes do SIGKILL. */
  killGraceMs?: number;
}

export interface RunResult {
  job: string;
  runId: string | undefined;
  status: 'ok' | 'error';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Executa o CLI do job num processo filho (isolamento: um job que trava ou vaza memória não derruba o scheduler),
 * com timeout, e registra início/fim em ops.job_run. O stdout/stderr do filho (logs JSON) segue para o do container.
 */
export async function runJob(job: ScheduledJob, options: RunOptions): Promise<RunResult> {
  const startedAt = Date.now();
  let runId: string | undefined;
  try {
    runId = await options.recorder?.start(job.name);
  } catch (err) {
    options.logger.error({ err, job: job.name }, 'não foi possível registrar o início do job em ops.job_run');
  }
  const log = options.logger.child({ job: job.name, ...(runId ? { scheduler_run_id: runId } : {}) });
  log.info({ trigger: options.trigger, script: job.script }, 'job iniciado');

  const outcome = await new Promise<
    Pick<RunResult, 'exitCode' | 'signal' | 'timedOut'> & { spawnError?: Error }
  >((done) => {
    const child = spawn(process.execPath, [resolve(options.cwd, job.script), ...job.args], {
      cwd: options.cwd,
      env: { ...(options.env ?? process.env), ...(runId ? { GALAXIE_SCHEDULER_RUN_ID: runId } : {}) },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      log.warn({ timeout_ms: job.timeoutMs }, 'job excedeu o tempo limite; encerrando');
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), options.killGraceMs ?? 10_000);
    }, job.timeoutMs);
    child.once('error', (spawnError) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      done({ exitCode: null, signal: null, timedOut, spawnError });
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      done({ exitCode, signal, timedOut });
    });
  });

  const durationMs = Date.now() - startedAt;
  const status = outcome.exitCode === 0 && !outcome.timedOut ? 'ok' : 'error';
  const error =
    status === 'ok'
      ? null
      : outcome.spawnError
        ? `falha ao iniciar: ${outcome.spawnError.message}`
        : outcome.timedOut
          ? `tempo limite de ${job.timeoutMs} ms excedido`
          : `processo terminou com código ${outcome.exitCode ?? '-'}${outcome.signal ? ` (sinal ${outcome.signal})` : ''}`;

  if (runId && options.recorder) {
    try {
      await options.recorder.finish(runId, status, error, {
        exit_code: outcome.exitCode,
        signal: outcome.signal,
        duration_ms: durationMs,
        trigger: options.trigger,
      });
    } catch (err) {
      log.error({ err }, 'não foi possível registrar o fim do job em ops.job_run');
    }
  }

  const fields = { status, exit_code: outcome.exitCode, duration_ms: durationMs };
  if (status === 'ok') log.info(fields, 'job concluído');
  else log.error({ ...fields, error }, 'job falhou');

  return { job: job.name, runId, status, durationMs, ...outcome };
}
