/** Utilitários comuns às CLIs de jobs (bootstrap:*, sync:daily): flags, plano, relatório. */
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import type { PgQuotaGovernor, PlanLimits } from '@galaxie/apisports-client';
import type { JobContext } from '../context.js';
import {
  emptyCounts,
  planJob,
  runJob,
  type AfterFetch,
  type JobPlan,
  type JobReport,
  type JobSpec,
  type PhaseReport,
  type StepCounts,
} from '../jobs/runtime/runner.js';

export const COMMON_OPTIONS = {
  /** Só mostra o plano (rede × cache × feito por passo), sem chamar o fornecedor. */
  plan: { type: 'boolean', default: false },
  /** Planeja o dia sem ao vivo (LIVE = 0) para liberar a folga ao BOOTSTRAP. */
  'sem-live': { type: 'boolean', default: false },
  /** Máximo de chamadas que gastam cota nesta execução. */
  'max-chamadas': { type: 'string' },
  /** Ignora os cursores (refaz; o cache do raw continua valendo). */
  forcar: { type: 'boolean', default: false },
  /** Chamadas por dia usadas na estimativa de dias do --plan. */
  'por-dia': { type: 'string' },
} as const satisfies ParseArgsOptionsConfig;

export function parseCli<O extends ParseArgsOptionsConfig>(options: O) {
  return parseArgs({ options: { ...COMMON_OPTIONS, ...options }, allowPositionals: true, strict: true });
}

export function intOption(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${flag} precisa ser um inteiro ≥ 0 (recebido: ${String(value)}).`);
  return n;
}

export function listOption(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((v) => {
    const n = Number(v.trim());
    if (!Number.isInteger(n)) throw new Error(`Lista inválida: "${value}" (use IDs separados por vírgula).`);
    return n;
  });
}

/**
 * Chamadas de BOOTSTRAP por dia para a estimativa: limite − reserva (15%) − o que o sync diário consome
 * (≈ 45 no free, ≈ 100 nos pagos), supondo dias planejados com `--sem-live`.
 */
export function defaultPerDay(limits: PlanLimits): number {
  const paid = !limits.forbiddenParams.includes('ids');
  return Math.max(1, Math.floor(limits.dailyLimit * 0.85) - (paid ? 100 : 45));
}

/** Libera a folga do dia para o BOOTSTRAP: LIVE = 0 e DAILY = o que já foi usado. */
export async function planDayWithoutLive(governor: PgQuotaGovernor, api = 'football'): Promise<void> {
  const usage = await governor.usage(api);
  await governor.plan(api, usage.dayUtc, { LIVE: 0, DAILY: usage.used.DAILY });
  console.log(`Dia ${usage.dayUtc} planejado sem ao vivo: folga liberada para o BOOTSTRAP.`);
}

function rows(phases: PhaseReport[], withPending: boolean) {
  return phases.flatMap((p) =>
    (Object.keys(p.steps).length
      ? Object.entries(p.steps)
      : ([['(nada no raw ainda)', emptyCounts()]] as [string, StepCounts][])
    ).map(([step, c]: [string, StepCounts]) => ({
      fase: p.name + (p.partial ? ' *' : ''),
      passo: step,
      total: c.total,
      feito: c.done,
      cache: c.cache,
      rede: c.network,
      bloqueado: c.blocked,
      sem_cobertura: c.noCoverage,
      falhou: c.failed,
      ...(withPending ? { pendente: c.pending } : {}),
    })),
  );
}

export function printPlan(plan: JobPlan, perDay: number): void {
  console.log(`Plano de ${plan.job} (nenhuma chamada feita):`);
  const r = rows(plan.phases, false);
  if (r.length) console.table(r);
  else console.log('  nada a fazer.');
  if (plan.phases.some((p) => p.partial)) {
    console.log(
      '  * fase montada a partir do raw atual; cresce quando a fase anterior for executada (estimativa por baixo).',
    );
  }
  const t = plan.totals;
  const days = Math.ceil(t.network / perDay);
  console.log(
    `Gastariam cota: ${t.network} · do raw (cache): ${t.cache} · já feitas: ${t.done} · bloqueadas pelo plano: ${t.blocked} · sem cobertura: ${t.noCoverage}`,
  );
  console.log(`Estimativa: ~${days} dia(s) a ${perDay} chamadas/dia (ajuste com --por-dia).`);
}

const STOP_LABEL = {
  quota: 'cota do dia esgotada para a prioridade',
  max_calls: 'limite de chamadas desta execução',
  provider: 'erro do fornecedor que vale para a API inteira',
} as const;

export function printReport(report: JobReport): void {
  const r = rows(report.phases, true);
  if (r.length) console.table(r);
  const t = report.totals;
  console.log(
    `${report.job} (job_run ${report.runId}): ${report.callsSpent} chamada(s) gastas · ${t.cache} do cache · ${t.done} já feitas.`,
  );
  if (report.status === 'partial') {
    console.log(
      `Parou: ${STOP_LABEL[report.stoppedBy!]} (${report.reason}). Restam ${t.pending} item(ns) nesta fase` +
        (report.skippedPhases.length ? ` e as fases: ${report.skippedPhases.join(', ')}` : '') +
        ' — a próxima execução continua de onde parou.',
    );
  } else {
    console.log('Concluído.');
  }
}

export interface CommonValues {
  plan?: boolean | undefined;
  'sem-live'?: boolean | undefined;
  'max-chamadas'?: string | undefined;
  forcar?: boolean | undefined;
  'por-dia'?: string | undefined;
}

/** `--plan` mostra o plano; sem ele, executa (com `--sem-live`, `--max-chamadas` e `--forcar`). */
export async function planOrRun(
  ctx: JobContext,
  spec: JobSpec,
  v: CommonValues,
  opts: { afterFetch?: AfterFetch } = {},
): Promise<JobReport | undefined> {
  const force = v.forcar ?? false;
  if (v.plan) {
    const perDay = intOption(v['por-dia'], 'por-dia') ?? defaultPerDay(ctx.plan.current);
    printPlan(await planJob(spec, ctx, { force }), perDay);
    return undefined;
  }
  if (ctx.offline) console.log('Sem APISPORTS_KEY: modo offline — só o que já está no raw, nada é chamado.');
  if (v['sem-live']) await planDayWithoutLive(ctx.governor);
  const report = await runJob(spec, ctx, {
    maxCalls: intOption(v['max-chamadas'], 'max-chamadas'),
    force,
    afterFetch: opts.afterFetch,
  });
  printReport(report);
  return report;
}

/** Executa a CLI imprimindo erros em português e com código de saída ≠ 0. */
export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
