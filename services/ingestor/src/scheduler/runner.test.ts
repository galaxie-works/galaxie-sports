import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@galaxie/observability';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJob, type RunRecorder } from './runner.js';
import type { ScheduledJob } from './schedule.js';

let dir: string;
const logger = createLogger({ service: 'test', level: 'silent' });

class MemoryRecorder implements RunRecorder {
  rows = new Map<
    string,
    { job: string; status: string; error: string | null; stats?: Record<string, unknown> }
  >();
  async start(job: string) {
    const id = `run-${this.rows.size + 1}`;
    this.rows.set(id, { job, status: 'running', error: null });
    return id;
  }
  async finish(id: string, status: 'ok' | 'error', error: string | null, stats: Record<string, unknown>) {
    this.rows.set(id, { ...this.rows.get(id)!, status, error, stats });
  }
}

const job = (script: string, extra: Partial<ScheduledJob> = {}): ScheduledJob => ({
  name: 'teste',
  description: '',
  cron: '* * * * *',
  script,
  args: [],
  timeoutMs: 10_000,
  ...extra,
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'galaxie-runner-'));
  await writeFile(join(dir, 'ok.mjs'), 'if (!process.env.GALAXIE_SCHEDULER_RUN_ID) process.exit(3);');
  await writeFile(join(dir, 'fail.mjs'), 'process.exit(2);');
  await writeFile(join(dir, 'hang.mjs'), 'setInterval(() => {}, 1000);');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runJob', () => {
  it('registra sucesso e repassa o id da execução ao processo filho', async () => {
    const recorder = new MemoryRecorder();
    const result = await runJob(job('ok.mjs'), { cwd: dir, recorder, logger, trigger: 'manual' });
    expect(result).toMatchObject({ status: 'ok', exitCode: 0, runId: 'run-1' });
    expect(recorder.rows.get('run-1')).toMatchObject({ job: 'teste', status: 'ok', error: null });
    expect(recorder.rows.get('run-1')!.stats).toMatchObject({ exit_code: 0, trigger: 'manual' });
  });

  it('registra falha com o código de saída', async () => {
    const recorder = new MemoryRecorder();
    const result = await runJob(job('fail.mjs'), { cwd: dir, recorder, logger, trigger: 'schedule' });
    expect(result.status).toBe('error');
    expect(recorder.rows.get('run-1')).toMatchObject({
      status: 'error',
      error: 'processo terminou com código 2',
    });
  });

  it('encerra o job que passa do tempo limite', async () => {
    const recorder = new MemoryRecorder();
    const result = await runJob(job('hang.mjs', { timeoutMs: 300 }), {
      cwd: dir,
      recorder,
      logger,
      trigger: 'schedule',
      killGraceMs: 200,
    });
    expect(result).toMatchObject({ status: 'error', timedOut: true });
    expect(recorder.rows.get('run-1')!.error).toMatch(/tempo limite/);
  });

  it('roda mesmo sem banco para registrar', async () => {
    const result = await runJob(job('fail.mjs'), { cwd: dir, logger, trigger: 'manual' });
    expect(result).toMatchObject({ status: 'error', runId: undefined });
  });

  it('trava ocupada por outro processo: pula sem rodar nem registrar', async () => {
    const recorder = new MemoryRecorder();
    const result = await runJob(job('ok.mjs'), {
      cwd: dir,
      recorder,
      logger,
      trigger: 'manual',
      lock: async () => null,
    });
    expect(result).toMatchObject({ status: 'skipped', runId: undefined, exitCode: null });
    expect(recorder.rows.size).toBe(0);
  });

  it('solta a trava ao terminar (também em falha) e segue sem ela se o banco não responder', async () => {
    const released: string[] = [];
    const lock = async (name: string) => ({
      release: async () => {
        released.push(name);
      },
    });
    const recorder = new MemoryRecorder();
    expect(
      (await runJob(job('fail.mjs'), { cwd: dir, recorder, logger, trigger: 'schedule', lock })).status,
    ).toBe('error');
    expect(released).toEqual(['teste']);
    const offline = await runJob(job('ok.mjs'), {
      cwd: dir,
      recorder,
      logger,
      trigger: 'schedule',
      lock: async () => {
        throw new Error('banco fora');
      },
    });
    expect(offline.status).toBe('ok');
  });
});
