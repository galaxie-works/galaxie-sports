import { and, eq } from 'drizzle-orm';
import { jobRun, type Database } from '@galaxie/db';

export type JobRunStatus = 'running' | 'ok' | 'partial' | 'error';

export interface JobRunFinish {
  status: Exclude<JobRunStatus, 'running'>;
  callsSpent: number;
  stats: Record<string, unknown>;
  error?: string | undefined;
}

/** ops.job_run: uma linha por execução de job (status, chamadas gastas, contagens por passo). */
export interface JobRunStore {
  start(job: string): Promise<string>;
  finish(id: string, result: JobRunFinish): Promise<void>;
}

export class InMemoryJobRunStore implements JobRunStore {
  readonly runs: ({ id: string; job: string; status: JobRunStatus } & Partial<
    Omit<JobRunFinish, 'status'>
  >)[] = [];

  async start(job: string): Promise<string> {
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({ id, job, status: 'running' });
    return id;
  }

  async finish(id: string, result: JobRunFinish): Promise<void> {
    const run = this.runs.find((r) => r.id === id);
    if (run) Object.assign(run, result);
  }
}

export class PgJobRunStore implements JobRunStore {
  constructor(private readonly db: Database) {}

  async start(job: string): Promise<string> {
    const [run] = await this.db
      .insert(jobRun)
      .values({ job, status: 'running' })
      .returning({ id: jobRun.id });
    return run!.id;
  }

  async finish(id: string, result: JobRunFinish): Promise<void> {
    await this.db
      .update(jobRun)
      .set({
        status: result.status,
        finishedAt: new Date(),
        callsSpent: result.callsSpent,
        stats: result.stats,
        error: result.error ?? null,
      })
      .where(eq(jobRun.id, id));
  }

  /** Fecha as execuções do job que ficaram abertas (o processo morreu sem registrar o fim). Devolve quantas. */
  async closeInterrupted(job: string, error: string): Promise<number> {
    const rows = await this.db
      .update(jobRun)
      .set({ status: 'error', finishedAt: new Date(), error })
      .where(and(eq(jobRun.job, job), eq(jobRun.status, 'running')))
      .returning({ id: jobRun.id });
    return rows.length;
  }
}
