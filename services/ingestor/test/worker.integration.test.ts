/**
 * Worker da fila (#542) no Postgres: dois workers e uma tarefa `exemplo.eco` com lotes lentos; o primeiro recebe o
 * SIGTERM no meio (o `docker stop`), drena e devolve a tarefa com o checkpoint, e o segundo continua do lote seguinte.
 *
 * Duas versões: o laço (`TaskWorker`) com o `runTask` no mesmo processo, que roda em qualquer sistema, e os processos
 * de verdade (`node dist/cli/worker.js`, com o filho por `fork`), que precisam do build do pacote e de sinais POSIX
 * (no Windows o SIGTERM mata na hora; o CI roda em Linux).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobRequest, jobRun, type Database } from '@galaxie/db';
import { enqueue, finish, release, renew, takeNext, type QueueTask } from '@galaxie/db/queue';
import { readLog, readProgress } from '@galaxie/db/queue-types';
import { createLogger } from '@galaxie/observability';
import { runTask } from '../src/tasks/run.js';
import { TaskWorker, type TaskProcess, type TaskProcessExit } from '../src/worker/loop.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
const log = createLogger({ service: 'test', level: 'silent' });
const ECO = 'exemplo.eco';
const LOTES = 6;

beforeAll(async () => {
  db = await disposable.setup();
});
afterAll(() => disposable.teardown());
beforeEach(async () => {
  await db.delete(jobRequest);
  await db.delete(jobRun);
});

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  ms = 30_000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`esperando ${what}: tempo esgotado`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const row = async (id: string) => (await db.select().from(jobRequest).where(eq(jobRequest.id, id)))[0]!;
const runs = (id: string) =>
  db.select().from(jobRun).where(eq(jobRun.requestId, id)).orderBy(asc(jobRun.startedAt));

/** O filho de mentira: o `runTask` de verdade, no mesmo processo, com os sinais de parada e de concessão perdida. */
function inProcess(task: QueueTask): TaskProcess {
  const stop = new AbortController();
  const lost = new AbortController();
  const done: Promise<TaskProcessExit> = runTask(db, task, {
    signal: stop.signal,
    leaseLost: lost.signal,
  }).then(
    (result) => ({ result, exitCode: 0, signal: null }),
    (err: unknown) => ({ error: String(err), exitCode: 1, signal: null }),
  );
  return {
    done,
    stop: () => stop.abort(),
    leaseLost: () => lost.abort(),
    kill: () => lost.abort(),
  };
}

const workerOf = (id: string) =>
  new TaskWorker(
    { workerId: id, concurrency: { [ECO]: 1 }, maxTasks: 1, drainMs: 10_000, idleMinMs: 100, idleMaxMs: 300 },
    {
      take: (types) => takeNext(db, id, types),
      renew: (task) => renew(db, task),
      release: (task) => release(db, task),
      fail: (task, detail) => finish(db, task, 'error', detail),
      spawn: inProcess,
      log,
    },
  );

/** As linhas do log da tarefa, em ordem: cada lote aparece uma vez se a retomada continuou do seguinte. */
const lotesNoLog = (checkpoint: unknown) => readLog(checkpoint).map((l) => l.split(':')[0]);

async function assertResumed(id: string, first: string, second: string) {
  const done = await row(id);
  expect(done.status).toBe('done');
  expect(readProgress(done.checkpoint)).toMatchObject({ feitos: LOTES, total: LOTES });
  expect(lotesNoLog(done.checkpoint)).toEqual(
    Array.from({ length: LOTES }, (_, i) => `lote ${i + 1}/${LOTES}`),
  );
  // a drenagem devolveu a tentativa: a retomada é a tentativa 1 de novo
  expect(done.attempts).toBe(1);
  const [cut, resumed] = await runs(id);
  expect(cut).toMatchObject({ status: 'interrupted' });
  expect((cut!.stats as { worker: string }).worker).toBe(first);
  expect(resumed).toMatchObject({ status: 'ok', resumedFrom: cut!.id });
  expect((resumed!.stats as { worker: string }).worker).toBe(second);
}

describe('worker da fila: drenagem e retomada (laço no mesmo processo)', () => {
  it('SIGTERM no meio: o lote fecha, a tarefa volta com o checkpoint e o outro worker continua do seguinte', async () => {
    const { id } = await enqueue(db, {
      type: ECO,
      params: { mensagem: 'oi', repeticoes: LOTES, pausaMs: 300 },
    });
    const a = workerOf('worker-a');
    void a.start();
    await waitFor(
      'dois lotes no worker A',
      async () => (readProgress((await row(id)).checkpoint)?.feitos ?? 0) >= 2,
    );
    expect(a.state()).toMatchObject({ idle: false, task: { id, type: ECO } });

    const b = workerOf('worker-b');
    void b.start();
    await a.drain();
    expect(a.state()).toMatchObject({ idle: true, draining: true });
    const cut = await row(id);
    expect(['pending', 'running']).toContain(cut.status);
    const feitosNoCorte = readProgress(cut.checkpoint)?.feitos ?? 0;
    expect(feitosNoCorte).toBeGreaterThanOrEqual(2);
    expect(feitosNoCorte).toBeLessThan(LOTES);

    await waitFor('a tarefa concluída pelo worker B', async () => (await row(id)).status === 'done');
    await b.drain();
    await assertResumed(id, 'worker-a', 'worker-b');
  });
});

const dist = fileURLToPath(new URL('../dist/cli/worker.js', import.meta.url));
const posix = process.platform !== 'win32';

describe.skipIf(!posix)('worker da fila: processos de verdade (node dist/cli/worker.js)', () => {
  const procs: ChildProcess[] = [];
  afterAll(() => {
    for (const p of procs) if (p.exitCode === null) p.kill('SIGKILL');
  });

  /** Sobe um worker e junta o log dele. */
  function startWorker(id: string, port: number) {
    if (!existsSync(dist))
      throw new Error('dist/cli/worker.js não existe: rode pnpm --filter @galaxie/ingestor build antes');
    const child = spawn(process.execPath, [dist], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: disposable.url,
        WORKER_ID: id,
        WORKER_OPS_PORT: String(port),
        WORKER_DRAIN_S: '20',
        LOG_LEVEL: 'info',
        METRICS_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(child);
    let out = '';
    child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
    return { child, log: () => out, exited };
  }

  it('docker stop (SIGTERM) no meio: "drenando" no log, checkpoint gravado e o outro worker continua', async () => {
    const { id } = await enqueue(db, {
      type: ECO,
      params: { mensagem: 'oi', repeticoes: LOTES, pausaMs: 700 },
    });
    const a = startWorker('worker-a', 18_481);
    await waitFor(
      'dois lotes no worker A',
      async () => (readProgress((await row(id)).checkpoint)?.feitos ?? 0) >= 2,
      60_000,
    );
    const health = (await (await fetch('http://127.0.0.1:18481/health')).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ status: 'ok', service: 'worker', idle: false, task: { id, type: ECO } });
    const metrics = await (await fetch('http://127.0.0.1:18481/metrics')).text();
    expect(metrics).toContain('worker_tasks_running{type="exemplo.eco"} 1');

    const b = startWorker('worker-b', 18_482);
    a.child.kill('SIGTERM');
    expect(await a.exited).toBe(0);
    expect(a.log()).toContain('drenando');
    expect(a.log()).toContain('tarefa devolvida à fila com o checkpoint');
    const cut = await row(id);
    expect(readProgress(cut.checkpoint)?.feitos ?? 0).toBeLessThan(LOTES);

    await waitFor('a tarefa concluída pelo worker B', async () => (await row(id)).status === 'done', 60_000);
    b.child.kill('SIGTERM');
    expect(await b.exited).toBe(0);
    await assertResumed(id, 'worker-a', 'worker-b');
  }, 120_000);
});
