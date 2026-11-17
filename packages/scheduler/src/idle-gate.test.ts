import type { Database } from '@galaxie/db';
import { createLogger } from '@galaxie/observability';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IDLE_FULL_EVERY_MS, IdleGate } from './idle-gate.js';
import type { RunRecorder } from './runner.js';
import type { ScheduledJob } from './schedule.js';

const logger = createLogger({ service: 'test', level: 'silent' });
const db = {} as Database;

class MemoryRecorder implements RunRecorder {
  rows: { job: string; status: string; stats: Record<string, unknown> }[] = [];
  async start(job: string) {
    this.rows.push({ job, status: 'running', stats: {} });
    return `run-${this.rows.length}`;
  }
  async finish(
    id: string,
    status: 'ok' | 'error' | 'budget_skipped',
    _error: string | null,
    stats: Record<string, unknown>,
  ) {
    const row = this.rows[Number(id.slice(4)) - 1]!;
    row.status = status;
    row.stats = stats;
  }
}

function setup(hasWork: () => Promise<boolean>, fullEveryMs?: number) {
  let now = 1_000_000;
  const calls = { checks: 0 };
  const recorder = new MemoryRecorder();
  const gate = new IdleGate({ db, recorder, logger, now: () => now });
  const job: ScheduledJob = {
    name: 'review-suggestions',
    description: '',
    cron: '*/15 * * * *',
    script: 'dist/cli/x.js',
    args: [],
    timeoutMs: 60_000,
    idleCheck: {
      hasWork: () => {
        calls.checks++;
        return hasWork();
      },
      ...(fullEveryMs !== undefined ? { fullEveryMs } : {}),
    },
  };
  return { gate, job, recorder, calls, advance: (ms: number) => (now += ms) };
}

describe('IdleGate', () => {
  it('na partida roda completo, sem consultar', async () => {
    const { gate, job, calls } = setup(async () => false);
    expect(await gate.check(job, 'schedule')).toBeNull();
    expect(calls.checks).toBe(0);
  });

  it('sem trabalho: não sobe o job e registra a execução como ok com stats.idle', async () => {
    const { gate, job, recorder, advance } = setup(async () => false);
    await gate.check(job, 'schedule');
    advance(15 * 60_000);
    const result = await gate.check(job, 'schedule');
    expect(result).toMatchObject({ job: 'review-suggestions', status: 'ok', runId: 'run-1' });
    expect(recorder.rows).toEqual([
      {
        job: 'review-suggestions',
        status: 'ok',
        stats: expect.objectContaining({ idle: true, trigger: 'schedule' }),
      },
    ]);
  });

  it('com trabalho: roda o job', async () => {
    const { gate, job, recorder, advance } = setup(async () => true);
    await gate.check(job, 'schedule');
    advance(60_000);
    expect(await gate.check(job, 'schedule')).toBeNull();
    expect(recorder.rows).toEqual([]);
  });

  it('consulta que falha roda o job completo', async () => {
    const { gate, job, advance } = setup(async () => {
      throw new Error('banco fora');
    });
    await gate.check(job, 'schedule');
    advance(60_000);
    expect(await gate.check(job, 'schedule')).toBeNull();
  });

  it('roda completo a cada fullEveryMs mesmo sem trabalho', async () => {
    const { gate, job, calls, advance } = setup(async () => false, 60 * 60_000);
    await gate.check(job, 'schedule'); // partida: completo
    advance(30 * 60_000);
    expect(await gate.check(job, 'schedule')).not.toBeNull(); // pulado
    advance(30 * 60_000);
    expect(await gate.check(job, 'schedule')).toBeNull(); // 1 h desde o último completo
    expect(calls.checks).toBe(1);
    advance(10 * 60_000);
    expect(await gate.check(job, 'schedule')).not.toBeNull(); // conta de novo a partir dele
  });

  it('o padrão da execução completa forçada é 6 h', () => {
    expect(DEFAULT_IDLE_FULL_EVERY_MS).toBe(6 * 3_600_000);
  });

  it('painel, --run e partida não passam pela consulta', async () => {
    const { gate, job, calls, advance } = setup(async () => false);
    await gate.check(job, 'schedule');
    for (const trigger of ['panel', 'manual', 'start', 'keepalive'] as const) {
      advance(60_000);
      expect(await gate.check(job, trigger)).toBeNull();
    }
    expect(calls.checks).toBe(0);
  });

  it('o catch-up passa pela consulta', async () => {
    const { gate, job, advance } = setup(async () => false);
    await gate.check(job, 'schedule');
    advance(60_000);
    expect(await gate.check(job, 'catchup')).not.toBeNull();
  });

  it('job sem idleCheck roda sempre', async () => {
    const { gate, job } = setup(async () => false);
    const plain: ScheduledJob = { ...job };
    delete plain.idleCheck;
    expect(await gate.check(plain, 'schedule')).toBeNull();
    expect(await gate.check(plain, 'schedule')).toBeNull();
  });
});
