import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { jobRun, type Database, type JobLock } from '@galaxie/db';
import { EXIT_BUDGET_SKIPPED } from '@galaxie/runtime-config';
import type { Logger } from '@galaxie/observability';
import type { ScheduledJob } from './schedule.js';

/** Onde o scheduler registra cada execução (ops.job_run alimenta as métricas e o alerta "job falhando 3×"). */
export interface RunRecorder {
  start(job: string): Promise<string>;
  finish(
    id: string,
    status: 'ok' | 'error' | 'budget_skipped',
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
    status: 'ok' | 'error' | 'budget_skipped',
    error: string | null,
    stats: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(jobRun)
      // soma às estatísticas que o próprio job gravou (mergeJobRunStats), sem apagá-las
      .set({
        status,
        error,
        stats: sql`coalesce(${jobRun.stats}, '{}'::jsonb) || ${JSON.stringify(stats)}::jsonb`,
        finishedAt: new Date(),
      })
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
  /** Heap do processo do job quando a definição não traz o seu (--max-old-space-size, MB). */
  heapMb?: number;
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
  /**
   * `skipped`: outro processo já rodava o job (trava ocupada); nada foi executado. `budget_skipped`: o
   * job gravou a saída determinística porque o orçamento de IA recusou (saída EXIT_BUDGET_SKIPPED).
   */
  status: 'ok' | 'error' | 'skipped' | 'budget_skipped';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

/** Código de saída do `scheduler --run`: budget_skipped (gravou o determinístico) não é falha. */
export const runExitCode = (status: RunResult['status']): number =>
  status === 'ok' || status === 'budget_skipped' ? 0 : 1;

/**
 * Heap padrão de um job (MB). O teto faz o job que vaza memória morrer sozinho com "heap out of memory" (código
 * 134 em ops.job_run), em vez de o kernel matar o maior processo do contêiner (o ao vivo, ou o scheduler).
 */
export const DEFAULT_JOB_HEAP_MB = 160;

/**
 * Geração nova de cada job: 3 × 8 MB. Sem o flag, o V8 dimensiona pelo tamanho da máquina e pode reservar até
 * ~190 MB por processo, o que tiraria a soma dos jobs do mem_limit.
 */
export const JOB_SEMI_SPACE_MB = 8;

/** Flags de memória do filho (vêm antes do script e valem por cima de um NODE_OPTIONS herdado). */
export function heapFlags(job: Pick<ScheduledJob, 'heapMb'>, fallbackMb = DEFAULT_JOB_HEAP_MB): string[] {
  const mb = job.heapMb ?? fallbackMb;
  return [
    `--max-old-space-size=${Math.max(32, Math.round(mb))}`,
    `--max-semi-space-size=${JOB_SEMI_SPACE_MB}`,
  ];
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
    const child = spawn(
      process.execPath,
      [...heapFlags(job, options.heapMb), resolve(cwd, job.script), ...job.args],
      {
        cwd,
        env: {
          // nome da sessão no Postgres (pg_stat_activity): quem segura conexão ou consulta
          PGAPPNAME: `galaxie-job:${job.name}`,
          ...(options.env ?? process.env),
          // o job sabe que veio do scheduler: a IA desconta das faixas por prioridade, não da `manual`
          GALAXIE_INVOKER: 'scheduler',
          ...(runId ? { GALAXIE_SCHEDULER_RUN_ID: runId } : {}),
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
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
  const status: 'ok' | 'error' | 'budget_skipped' = outcome.timedOut
    ? 'error'
    : outcome.exitCode === 0
      ? 'ok'
      : outcome.exitCode === EXIT_BUDGET_SKIPPED
        ? 'budget_skipped'
        : 'error';
  const error =
    status !== 'error'
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
  else if (status === 'budget_skipped')
    log.warn(fields, 'job concluído com a saída determinística: orçamento de IA recusou');
  else log.error({ ...fields, error }, 'job falhou');

  return { job: job.name, runId, status, durationMs, ...outcome };
}
