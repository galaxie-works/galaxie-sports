import type { Database } from '@galaxie/db';
import type { Logger } from '@galaxie/observability';
import type { RunRecorder, RunResult, RunTrigger } from './runner.js';
import type { ScheduledJob } from './schedule.js';

/** Sem `fullEveryMs` no job: a execução completa forçada vem a cada 6 h, com ou sem trabalho. */
export const DEFAULT_IDLE_FULL_EVERY_MS = 6 * 3_600_000;

/** Só o horário da agenda e o catch-up passam pela consulta; painel, `--run` e a partida rodam sempre. */
const GATED_TRIGGERS: ReadonlySet<RunTrigger> = new Set(['schedule', 'catchup']);

export interface IdleGateOptions {
  db: Database;
  recorder?: RunRecorder | undefined;
  logger: Logger;
  /** Relógio (testes). */
  now?: () => number;
}

/**
 * Porta "há trabalho?" antes de subir o processo do job (#1304, CPU da VPS). Cada execução de job sobe um Node novo, e
 * só a subida (imports, conexões) custa de 2 a 4 s de CPU. O job com `idleCheck` faz antes, no processo do scheduler,
 * uma consulta leve; sem trabalho, a execução é registrada em ops.job_run como `ok` com `stats.idle = true` (a agenda e
 * os alertas de frescor seguem vendo o job rodar) e nenhum processo sobe.
 *
 * Por segurança, a consulta só pula: na partida do scheduler, a cada `fullEveryMs` e quando a própria consulta falha, o
 * job roda completo como antes.
 */
export class IdleGate {
  /** Última vez que cada job subiu de verdade (memória do processo: zera a cada partida, que roda completo). */
  private readonly lastFull = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: IdleGateOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * `null` = rode o job (e a execução conta como completa); senão, o resultado da execução pulada, já registrada.
   */
  async check(job: ScheduledJob, trigger: RunTrigger): Promise<RunResult | null> {
    const startedAt = this.now();
    if (!job.idleCheck || !GATED_TRIGGERS.has(trigger) || this.fullDue(job, startedAt)) {
      this.lastFull.set(job.name, startedAt);
      return null;
    }
    let hasWork: boolean;
    try {
      hasWork = await job.idleCheck.hasWork(this.options.db);
    } catch (err) {
      this.options.logger.warn(
        { err, job: job.name },
        'consulta "há trabalho?" falhou; rodando o job completo',
      );
      hasWork = true;
    }
    if (hasWork) {
      this.lastFull.set(job.name, startedAt);
      return null;
    }
    return this.recordIdle(job, trigger, startedAt);
  }

  private fullDue(job: ScheduledJob, at: number): boolean {
    const last = this.lastFull.get(job.name);
    const every = job.idleCheck?.fullEveryMs ?? DEFAULT_IDLE_FULL_EVERY_MS;
    return last === undefined || at - last >= every;
  }

  private async recordIdle(job: ScheduledJob, trigger: RunTrigger, startedAt: number): Promise<RunResult> {
    const { recorder, logger } = this.options;
    let runId: string | undefined;
    const durationMs = this.now() - startedAt;
    if (recorder) {
      try {
        runId = await recorder.start(job.name);
        await recorder.finish(runId, 'ok', null, {
          idle: true,
          exit_code: null,
          signal: null,
          duration_ms: durationMs,
          trigger,
        });
      } catch (err) {
        logger.warn(
          { err, job: job.name },
          'não foi possível registrar a execução sem trabalho em ops.job_run',
        );
      }
    }
    logger.debug({ job: job.name, trigger }, 'sem trabalho; job não subiu');
    return {
      job: job.name,
      runId,
      status: 'ok',
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs,
    };
  }
}
