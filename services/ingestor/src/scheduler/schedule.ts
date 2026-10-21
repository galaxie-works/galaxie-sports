import { Cron } from 'croner';

/** Um CLI existente do ingestor executado periodicamente (horários em UTC — o dia de cota vira às 00:00 UTC). */
export interface ScheduledJob {
  /** Nome estável: vira `job` em ops.job_run e label das métricas. */
  name: string;
  description: string;
  /** Expressão cron de 5 campos (UTC). */
  cron: string;
  /** Script relativo à raiz do pacote do ingestor. */
  script: string;
  args: string[];
  timeoutMs: number;
}

const MINUTE = 60_000;

/**
 * Agenda padrão do staging. Cada item pode ser sobrescrito por variável de ambiente
 * `SCHEDULE_<NOME_EM_MAIÚSCULAS>` (ex.: SCHEDULE_QUOTA_STATUS="*\/30 * * * *") ou desligado com "off".
 */
export const DEFAULT_JOBS: readonly ScheduledJob[] = [
  {
    name: 'sync-daily',
    description:
      'Sync diário do futebol (DAILY): agenda D-1/D0/D+1, lesões, detalhe dos encerrados, rodízio; idempotente no dia',
    cron: '5 0 * * *',
    script: 'dist/cli/sync-daily.js',
    args: [],
    timeoutMs: 120 * MINUTE,
  },
  {
    name: 'assets-mirror',
    description: 'Espelha logos/bandeiras/fotos do raw para o S3 (CDN de mídia; não consome cota da API)',
    cron: '30 1 * * *',
    script: 'dist/cli/mirror-assets.js',
    args: ['--descobrir-raw', '--limite', '2000'],
    timeoutMs: 90 * MINUTE,
  },
  {
    name: 'quota-status',
    description: 'Lê /status de cada API (não consome cota) e reconcilia o Quota Governor',
    cron: '5 * * * *',
    script: 'dist/cli/quota.js',
    args: [],
    timeoutMs: 10 * MINUTE,
  },
  {
    name: 'bootstrap-catalog',
    description:
      'Atualiza o catálogo global do futebol (~8 chamadas BOOTSTRAP; reaproveita o raw dentro do TTL)',
    cron: '15 3 * * 1',
    script: 'dist/cli/bootstrap-catalog.js',
    args: [],
    timeoutMs: 60 * MINUTE,
  },
];

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

/** Aplica as sobrescritas do ambiente: SCHEDULE_<JOB>=<cron>|off e SCHEDULER_TIMEOUT_MINUTES. */
export function scheduleFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  jobs: readonly ScheduledJob[] = DEFAULT_JOBS,
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
      ...(Number.isFinite(timeoutMinutes) && timeoutMinutes > 0
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
