/**
 * Catch-up do scheduler: um job cujo horário passou com o contêiner fora do ar (deploy, reinício) roda na volta, uma
 * vez. Sem isso, um deploy às 00:05 UTC pulava o sync diário até o dia seguinte.
 *
 * Na partida, para cada job da agenda efetiva (fora a faixa do ao vivo e os de cadência curta, que se recuperam
 * sozinhos no horário seguinte), acha o último horário previsto até agora e confere em ops.job_run se houve execução
 * iniciada a partir dele. Não houve, e o horário tem menos de SCHEDULER_CATCHUP_MAX_HOURS (padrão 24): roda agora,
 * com o gatilho `catchup`. Não duplica: a execução nova fica em ops.job_run (o próximo reinício a enxerga) e a trava
 * do job (advisory lock) pula se outro processo já o roda.
 *
 * Execução interrompida pelo reinício (SIGTERM no encerramento, ou `running` órfã de um processo morto, fechada aqui
 * com a trava livre) leva `stats.interrupted` e não conta como "rodou": o job cortado no meio roda de novo.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { jobRequest, jobRun, type Database, type JobLock } from '@galaxie/db';
import { nextRuns, type ScheduledJob } from './schedule.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface MissedSlot {
  job: string;
  /** Horário previsto que passou sem execução. */
  slot: Date;
}

export interface CatchUpOptions {
  now?: Date;
  /** Horário mais velho que isto não é recuperado (padrão 24 h). */
  maxAgeMs?: number;
  /** Cadência menor que isto se recupera sozinha no horário seguinte (padrão 30 min). */
  minIntervalMs?: number;
  /** Execução iniciada até este tanto antes do horário conta como dele (relógio, fila; padrão 1 min). */
  toleranceMs?: number;
}

/** Jobs cujo último horário previsto passou sem execução registrada. */
export function missedSlots(
  jobs: readonly ScheduledJob[],
  lastStarts: ReadonlyMap<string, Date>,
  options: CatchUpOptions = {},
): MissedSlot[] {
  const now = options.now ?? new Date();
  const maxAgeMs = options.maxAgeMs ?? 24 * HOUR;
  const minIntervalMs = options.minIntervalMs ?? 30 * MINUTE;
  const toleranceMs = options.toleranceMs ?? MINUTE;
  const out: MissedSlot[] = [];
  for (const job of jobs) {
    if (job.live) continue;
    const [a, b] = nextRuns(job, 2, now);
    if (!a || !b || b.getTime() - a.getTime() < minIntervalMs) continue;
    // horários da janela até agora; o último é o que vale (os anteriores já foram cobertos ou perdidos de vez)
    const from = new Date(now.getTime() - maxAgeMs);
    const count = Math.ceil(maxAgeMs / (b.getTime() - a.getTime())) + 2;
    const slot = nextRuns(job, count, from)
      .filter((d) => d.getTime() <= now.getTime())
      .at(-1);
    if (!slot) continue;
    const last = lastStarts.get(job.name);
    if (last && last.getTime() >= slot.getTime() - toleranceMs) continue;
    out.push({ job: job.name, slot });
  }
  return out;
}

/** Início da execução mais recente de cada job que não foi interrompida pelo reinício. */
export async function lastJobStarts(db: Database, jobs: readonly string[]): Promise<Map<string, Date>> {
  if (!jobs.length) return new Map();
  const rows = await db
    .select({ job: jobRun.job, startedAt: sql<string>`max(${jobRun.startedAt})` })
    .from(jobRun)
    .where(
      and(
        inArray(jobRun.job, [...jobs]),
        sql`coalesce(${jobRun.stats} ->> 'interrupted', 'false') <> 'true'`,
      ),
    )
    .groupBy(jobRun.job);
  return new Map(rows.filter((r) => r.startedAt).map((r) => [r.job, new Date(r.startedAt)]));
}

export interface OrphanReport {
  /** Execuções em ops.job_run fechadas como interrompidas. */
  runs: number;
  /** Pedidos de "rodar agora" (ops.job_request) fechados como interrompidos. */
  requests: number;
  /** Jobs com execução `running` que seguem com a trava ocupada (outro processo rodando de verdade). */
  busy: string[];
}

/**
 * Fecha o que um scheduler morto deixou como `running` (ops.job_run e ops.job_request), só para os jobs cuja trava
 * está livre: com a trava ocupada, outro processo (um `scheduler --run` no console, o contêiner antigo ainda saindo)
 * roda o job de verdade e a linha é dele.
 */
export async function closeOrphans(
  db: Database,
  jobs: readonly string[],
  opts: { bootedAt: Date; lock: (job: string) => Promise<JobLock | null> },
): Promise<OrphanReport> {
  const report: OrphanReport = { runs: 0, requests: 0, busy: [] };
  if (!jobs.length) return report;
  const [runRows, requestRows] = await Promise.all([
    db
      .selectDistinct({ job: jobRun.job })
      .from(jobRun)
      .where(
        and(
          inArray(jobRun.job, [...jobs]),
          eq(jobRun.status, 'running'),
          lt(jobRun.startedAt, opts.bootedAt),
        ),
      ),
    db
      .selectDistinct({ job: jobRequest.job })
      .from(jobRequest)
      .where(
        and(
          inArray(jobRequest.job, [...jobs]),
          eq(jobRequest.status, 'running'),
          lt(jobRequest.pickedAt, opts.bootedAt),
        ),
      ),
  ]);
  const names = [...new Set([...runRows, ...requestRows].map((r) => r.job))];
  const now = new Date();
  for (const job of names) {
    const lock = await opts.lock(job);
    if (!lock) {
      report.busy.push(job);
      continue;
    }
    try {
      const runs = await db
        .update(jobRun)
        .set({
          status: 'error',
          error: 'interrompido: o scheduler reiniciou com o job rodando',
          finishedAt: now,
          stats: sql`coalesce(${jobRun.stats}, '{}'::jsonb) || '{"interrupted": true}'::jsonb`,
        })
        .where(and(eq(jobRun.job, job), eq(jobRun.status, 'running'), lt(jobRun.startedAt, opts.bootedAt)))
        .returning({ id: jobRun.id });
      const requests = await db
        .update(jobRequest)
        .set({ status: 'error', finishedAt: now, detail: 'interrompido: o scheduler reiniciou' })
        .where(
          and(
            eq(jobRequest.job, job),
            eq(jobRequest.status, 'running'),
            lt(jobRequest.pickedAt, opts.bootedAt),
          ),
        )
        .returning({ id: jobRequest.id });
      report.runs += runs.length;
      report.requests += requests.length;
    } finally {
      await lock.release();
    }
  }
  return report;
}
