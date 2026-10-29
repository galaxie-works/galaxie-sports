import {
  SCHEDULED_JOBS,
  SETTINGS,
  budgetDayFromEnv,
  budgetDayOf,
  isCronOff,
  nextCronRuns,
  resolveAll,
  scheduleKey,
  type RuntimeService,
} from '@galaxie/runtime-config';

/**
 * Configuração efetiva lida pelas métricas (agendas dos jobs, teto e virada do dia da IA): a mesma precedência do
 * painel (banco > env relatado pelo serviço > padrão do código). A API não enxerga o env do ingestor nem dos
 * agentes; usa o que eles relatam em ops.runtime_env.
 */
export interface ReportedEnvRow {
  service: string;
  key: string;
  value: string | null;
}

const OPS_KEYS = new Set([
  ...SCHEDULED_JOBS.map((j) => scheduleKey(j.name)),
  'AI_DAILY_USD_BUDGET',
  'AI_BUDGET_DAY_START',
  'AI_BUDGET_TIMEZONE',
]);
const OPS_SETTINGS = SETTINGS.filter((d) => OPS_KEYS.has(d.key));

export function effectiveOpsSettings(
  overrides: ReadonlyMap<string, string>,
  reported: readonly ReportedEnvRow[],
): Map<string, string | null> {
  const env = new Map(reported.map((r) => [`${r.service}|${r.key}`, r.value]));
  const resolved = resolveAll(
    {
      overrides,
      env: (key) => {
        const def = OPS_SETTINGS.find((d) => d.key === key);
        return def ? (env.get(`${def.services[0]}|${key}`) ?? null) : null;
      },
    },
    OPS_SETTINGS,
  );
  return new Map(resolved.map((r) => [r.key, r.value]));
}

/** Maior intervalo entre as próximas execuções da agenda (s); null = desligada ou inválida. */
export function expectedIntervalSeconds(cron: string | null, now: Date): number | null {
  if (!cron || isCronOff(cron)) return null;
  const runs = nextCronRuns(cron, 8, now);
  if (runs.length < 2) return null;
  let max = 0;
  for (let i = 1; i < runs.length; i++) max = Math.max(max, runs[i]!.getTime() - runs[i - 1]!.getTime());
  return max / 1000;
}

export interface JobExpectation {
  job: string;
  service: RuntimeService;
  intervalSeconds: number;
}

/** Intervalo esperado de cada job ligado na agenda efetiva. */
export function jobExpectations(settings: ReadonlyMap<string, string | null>, now: Date): JobExpectation[] {
  const out: JobExpectation[] = [];
  for (const j of SCHEDULED_JOBS) {
    const key = scheduleKey(j.name);
    const interval = expectedIntervalSeconds(settings.has(key) ? (settings.get(key) ?? null) : j.cron, now);
    if (interval !== null) out.push({ job: j.name, service: j.service, intervalSeconds: interval });
  }
  return out;
}

/** Teto global da IA em US$ (null = `unlimited` ou ilegível) e o dia de orçamento corrente. */
export function aiBudget(
  settings: ReadonlyMap<string, string | null>,
  now: Date,
): { dailyUsd: number | null; budgetDay: string } {
  const raw = settings.get('AI_DAILY_USD_BUDGET')?.trim().toLowerCase();
  const n = raw && raw !== 'unlimited' ? Number(raw) : NaN;
  const day = budgetDayFromEnv({
    AI_BUDGET_DAY_START: settings.get('AI_BUDGET_DAY_START') ?? undefined,
    AI_BUDGET_TIMEZONE: settings.get('AI_BUDGET_TIMEZONE') ?? undefined,
  });
  return { dailyUsd: Number.isFinite(n) && n > 0 ? n : null, budgetDay: budgetDayOf(now, day) };
}
