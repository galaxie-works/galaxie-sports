import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { jobRun, type Database, type JobLock } from '@galaxie/db';
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

/** De onde veio a execução: agenda, CLI `--run`, SCHEDULER_RUN_ON_START ou o painel de Operação. */
export type RunTrigger = 'schedule' | 'manual' | 'start' | 'panel';

export interface RunOptions {
  /** Raiz do pacote do ingestor (onde fica dist/). Os CLIs resolvem caminhos relativos a ela. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  recorder?: RunRecorder | undefined;
  logger: Logger;
  trigger: RunTrigger;
  /** Tempo para o processo encerrar depois do SIGTERM antes do SIGKILL. */
  killGraceMs?: number;
  /** Encerramento do scheduler: repassa SIGTERM ao filho (ex.: o ao vivo termina o tick e sai). */
  signal?: AbortSignal | undefined;
  /**
   * Trava entre processos (no serviço real, advisory lock de sessão do Postgres, `tryJobLock`): `null` =
   * outro processo já roda este job, e esta execução é pulada sem registro em ops.job_run.
   */
  lock?: ((job: string) => Promise<JobLock | null>) | undefined;
}

export interface RunResult {
  job: string;
  runId: string | undefined;
  /** `skipped`: outro processo já rodava o job (trava ocupada); nada foi executado. */
  status: 'ok' | 'error' | 'skipped';
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
  let lock: JobLock | null | undefined;
  if (options.lock) {
    try {
      lock = await options.lock(job.name);
    } catch (err) {
      // banco fora: segue sem a trava (o job também depende do banco e falha por conta própria)
      options.logger.warn({ err, job: job.name }, 'não foi possível obter a trava do job; seguindo sem ela');
    }
    if (lock === null) {
      options.logger.warn(
        { job: job.name, trigger: options.trigger },
        'job já em execução em outro processo; pulando',
      );
      return {
        job: job.name,
        runId: undefined,
        status: 'skipped',
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
      };
    }
  }
  try {
    return await spawnJob(job, options, startedAt);
  } finally {
    await lock
      ?.release()
      .catch((err: unknown) =>
        options.logger.warn({ err, job: job.name }, 'não foi possível soltar a trava do job'),
      );
  }
}

async function spawnJob(job: ScheduledJob, options: RunOptions, startedAt: number): Promise<RunResult> {
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
    const cwd = resolve(options.cwd, job.cwd ?? '.');
    const child = spawn(process.execPath, [resolve(cwd, job.script), ...job.args], {
      cwd,
      env: { ...(options.env ?? process.env), ...(runId ? { GALAXIE_SCHEDULER_RUN_ID: runId } : {}) },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      log.info({}, 'scheduler encerrando; repassando SIGTERM ao job');
      child.kill('SIGTERM');
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      log.warn({ timeout_ms: job.timeoutMs }, 'job excedeu o tempo limite; encerrando');
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), options.killGraceMs ?? 10_000);
    }, job.timeoutMs);
    child.once('error', (spawnError) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      done({ exitCode: null, signal: null, timedOut, spawnError });
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
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
