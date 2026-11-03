import { Cron } from 'croner';

/** Um CLI executado periodicamente por um scheduler (horários em UTC — o dia de cota vira às 00:00 UTC). */
export interface ScheduledJob {
  /** Nome estável: vira `job` em ops.job_run e label das métricas. */
  name: string;
  description: string;
  /** Expressão cron de 5 campos (UTC). */
  cron: string;
  /** Script relativo à raiz do pacote dono do scheduler (onde fica o dist/ com os CLIs). */
  script: string;
  args: string[];
  /** Args quando roda sob demanda (painel "rodar agora", `scheduler --run`); padrão: `args`. */
  onDemandArgs?: string[];
  timeoutMs: number;
  /** O tempo limite é do job e não segue SCHEDULER_TIMEOUT_MINUTES (o ao vivo fica no ar por horas). */
  ownTimeout?: boolean;
  /**
   * Faixa do ao vivo: nunca espera na fila do teto de jobs simultâneos (SCHEDULER_MAX_JOBS). São poucos, cada um
   * roda uma vez só por vez (trava), e o heap deles entra na conta da memória do contêiner (README › Memória).
   */
  live?: boolean;
  /** Teto do heap do processo do job (--max-old-space-size, MB); padrão SCHEDULER_JOB_HEAP_MB. */
  heapMb?: number;
  /**
   * A tarefa da fila equivalente (`@galaxie/db/queue-types`). Com QUEUE_MODE=enqueue, o horário só enfileira esta
   * tarefa (dedupe por job e dia) e o worker executa; com `run` (padrão), o CLI roda como sempre (queue-mode.ts).
   */
  task?: {
    type: string;
    /** Params do tipo (validados pelo schema; os padrões dele completam o resto). */
    params?: Record<string, unknown>;
    priority?: number;
  };
}

/** Um minuto em ms, para os `timeoutMs` das definições dos jobs. */
export const MINUTE = 60_000;

export function envKey(name: string): string {
  return `SCHEDULE_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** Valida a expressão cron (5 campos) e lança um erro legível se for inválida. */
export function assertCron(pattern: string, name: string): void {
  try {
    new Cron(pattern, { paused: true, mode: '5-part', timezone: 'UTC' }).stop();
  } catch (err) {
    throw new Error(`Agenda inválida para "${name}": "${pattern}" (${(err as Error).message})`, {
      cause: err,
    });
  }
}

/**
 * Aplica as sobrescritas do ambiente: SCHEDULE_<JOB>=<cron>|off e SCHEDULER_TIMEOUT_MINUTES (este, só nos
 * jobs sem tempo limite próprio: um valor de 60 mataria o ao vivo a cada hora, no meio do jogo).
 */
export function scheduleFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  jobs: readonly ScheduledJob[],
): ScheduledJob[] {
  const timeoutMinutes = Number(env.SCHEDULER_TIMEOUT_MINUTES);
  const out: ScheduledJob[] = [];
  for (const job of jobs) {
    const override = env[envKey(job.name)]?.trim();
    if (override && ['off', 'false', 'disabled', '0'].includes(override.toLowerCase())) continue;
    const cron = override || job.cron;
    assertCron(cron, job.name);
    out.push({
      ...job,
      cron,
      ...(Number.isFinite(timeoutMinutes) && timeoutMinutes > 0 && !job.ownTimeout
        ? { timeoutMs: timeoutMinutes * MINUTE }
        : {}),
    });
  }
  return out;
}

/** Próximas execuções (UTC) — para `scheduler --list` e logs de partida. */
export function nextRuns(job: ScheduledJob, count = 3, from: Date = new Date()): Date[] {
  const cron = new Cron(job.cron, { paused: true, mode: '5-part', timezone: 'UTC' });
  const runs = cron.nextRuns(count, from);
  cron.stop();
  return runs;
}
