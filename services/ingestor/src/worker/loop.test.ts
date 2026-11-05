import type { QueueTask } from '@galaxie/db/queue';
import { createLogger } from '@galaxie/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { concurrencyVar, workerConfig } from './config.js';
import { TaskWorker, type TaskProcess, type TaskProcessExit, type WorkerDeps } from './loop.js';

const log = createLogger({ service: 'test', level: 'silent' });

const task = (id: string, type = 'exemplo.eco'): QueueTask => ({
  id,
  type,
  params: {},
  priority: 0,
  attempts: 1,
  maxAttempts: 3,
  checkpoint: null,
  workerId: 'w1',
  runId: `run-${id}`,
  resumedFrom: null,
  lockedUntil: new Date(Date.now() + 90_000),
});

/** Processo filho de mentira: o teste decide quando e como ele sai. */
class FakeProcess implements TaskProcess {
  stopped = false;
  lost = false;
  signals: NodeJS.Signals[] = [];
  private resolve!: (exit: TaskProcessExit) => void;
  done = new Promise<TaskProcessExit>((r) => (this.resolve = r));
  /** Ao receber `stop`, sai como o runTask faria depois do lote (devolve a tarefa). */
  constructor(private readonly onStop?: 'release' | 'ignore') {}
  stop() {
    this.stopped = true;
    if (this.onStop === 'release') this.exit({ result: 'released', exitCode: 0, signal: null });
  }
  leaseLost() {
    this.lost = true;
  }
  kill(signal: NodeJS.Signals) {
    this.signals.push(signal);
    this.exit({ exitCode: null, signal });
  }
  exit(e: TaskProcessExit) {
    this.resolve(e);
  }
}

function harness(queue: QueueTask[], opts: { onStop?: 'release' | 'ignore'; renewOk?: boolean } = {}) {
  const procs = new Map<string, FakeProcess>();
  const deps = {
    take: vi.fn(async (types: readonly string[]) => {
      const i = queue.findIndex((t) => types.includes(t.type));
      return i >= 0 ? queue.splice(i, 1)[0]! : null;
    }),
    renew: vi.fn(async () => opts.renewOk ?? true),
    release: vi.fn(async () => true),
    fail: vi.fn(async () => 'retry' as const),
    spawn: vi.fn((t: QueueTask) => {
      const p = new FakeProcess(opts.onStop);
      procs.set(t.id, p);
      return p;
    }),
    observe: vi.fn(),
    log,
  } satisfies WorkerDeps;
  return { deps, procs };
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

afterEach(() => {
  vi.useRealTimers();
});

describe('workerConfig', () => {
  it('concorrência por tipo pelo env, o espelho com 2, 0 tira o tipo; valor inválido fica no padrão', () => {
    const types = ['exemplo.eco', 'assets.espelhar', 'carga.historica'];
    expect(concurrencyVar('assets.espelhar')).toBe('WORKER_CONCURRENCY_ASSETS_ESPELHAR');
    const c = workerConfig(types, {
      WORKER_CONCURRENCY_CARGA_HISTORICA: '0',
      WORKER_CONCURRENCY_EXEMPLO_ECO: 'x',
      WORKER_MAX_TASKS: '3',
      WORKER_DRAIN_S: '45',
      WORKER_ID: 'w-a',
    });
    expect(c.concurrency).toEqual({ 'exemplo.eco': 1, 'assets.espelhar': 2 });
    expect(c.maxTasks).toBe(3);
    expect(c.drainMs).toBe(45_000);
    expect(c.heapMb).toBe(160);
    expect(c.opsPort).toBe(8080);
    expect(c.workerId).toBe('w-a');
    expect(c.invalid).toEqual(['WORKER_CONCURRENCY_EXEMPLO_ECO']);
  });
});

describe('TaskWorker', () => {
  it('toma, roda no filho e, sem tarefa, espera com backoff de 1 a 10 s', async () => {
    vi.useFakeTimers();
    const queue = [task('a')];
    const { deps, procs } = harness(queue);
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'exemplo.eco': 1 }, maxTasks: 2, drainMs: 60_000 },
      deps,
    );
    void w.start();
    await tick();
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(w.state()).toMatchObject({ idle: false, draining: false, task: { id: 'a', type: 'exemplo.eco' } });
    expect(w.runningByType()).toEqual({ 'exemplo.eco': 1 });
    // vaga do tipo cheia: não toma de novo enquanto o filho roda
    await tick(15_000);
    expect(deps.take).toHaveBeenCalledTimes(1);
    procs.get('a')!.exit({ result: 'done', exitCode: 0, signal: null });
    await tick();
    expect(w.state().idle).toBe(true);
    expect(deps.observe).toHaveBeenCalledWith('exemplo.eco', 'done', expect.any(Number));
    // fila vazia: 1 s, 2 s, 4 s, 8 s, 10 s…
    const calls = deps.take.mock.calls.length;
    await tick(1000);
    await tick(2000);
    await tick(4000);
    expect(deps.take.mock.calls.length).toBe(calls + 3);
    await tick(8000);
    await tick(10_000);
    await tick(10_000);
    expect(deps.take.mock.calls.length).toBe(calls + 6);
    await w.drain();
  });

  it('sem tarefa, a espera segura o processo no ar (a conexão do banco vence e nada mais segura)', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const { deps } = harness([]);
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'exemplo.eco': 1 }, maxTasks: 1, drainMs: 60_000, idleMinMs: 12_345 },
      deps,
    );
    void w.start();
    await vi.waitFor(() => {
      expect(timers.mock.calls.some(([, ms]) => ms === 12_345)).toBe(true);
    });
    const espera = timers.mock.results[timers.mock.calls.findIndex(([, ms]) => ms === 12_345)]!;
    expect((espera.value as NodeJS.Timeout).hasRef()).toBe(true);
    await w.drain();
    timers.mockRestore();
  });

  it('respeita a vaga por tipo e o teto geral', async () => {
    vi.useFakeTimers();
    const queue = [
      task('e1', 'assets.espelhar'),
      task('e2', 'assets.espelhar'),
      task('e3', 'assets.espelhar'),
      task('x'),
    ];
    const { deps } = harness(queue);
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'assets.espelhar': 2, 'exemplo.eco': 1 }, maxTasks: 3, drainMs: 1000 },
      deps,
    );
    void w.start();
    await tick(5000);
    expect(w.runningByType()).toEqual({ 'assets.espelhar': 2, 'exemplo.eco': 1 });
    expect(queue.map((t) => t.id)).toEqual(['e3']);
    expect(deps.take).toHaveBeenLastCalledWith(['exemplo.eco']);
    void w.drain();
    await tick(10_000);
  });

  it('renova a concessão a cada 30 s do pai; renovação recusada para o filho sem gravar nada', async () => {
    vi.useFakeTimers();
    const { deps, procs } = harness([task('a')], { renewOk: true });
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'exemplo.eco': 1 }, maxTasks: 1, drainMs: 60_000 },
      deps,
    );
    void w.start();
    await tick();
    await tick(30_000);
    await tick(30_000);
    expect(deps.renew).toHaveBeenCalledTimes(2);
    deps.renew.mockResolvedValue(false);
    await tick(30_000);
    const p = procs.get('a')!;
    expect(p.lost).toBe(true);
    expect(p.signals).toEqual(['SIGTERM']);
    await tick();
    expect(deps.release).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
    expect(deps.observe).toHaveBeenCalledWith('exemplo.eco', 'lost', expect.any(Number));
    await w.drain();
  });

  it('filho que sai sem resultado (heap estourado): o pai encerra a tomada em erro', async () => {
    vi.useFakeTimers();
    const { deps, procs } = harness([task('a')]);
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'exemplo.eco': 1 }, maxTasks: 1, drainMs: 60_000 },
      deps,
    );
    void w.start();
    await tick();
    procs.get('a')!.exit({ exitCode: 134, signal: null });
    await tick();
    expect(deps.fail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      expect.stringContaining('código 134'),
    );
    expect(deps.observe).toHaveBeenCalledWith('exemplo.eco', 'retry', expect.any(Number));
    await w.drain();
  });

  it('SIGTERM drena: para de tomar, o lote fecha e o filho devolve a tarefa; o pai não grava de novo', async () => {
    vi.useFakeTimers();
    const queue = [task('a'), task('b')];
    const { deps, procs } = harness(queue, { onStop: 'ignore' });
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'exemplo.eco': 1 }, maxTasks: 1, drainMs: 60_000 },
      deps,
    );
    void w.start();
    await tick();
    const drained = w.drain();
    await tick();
    const p = procs.get('a')!;
    expect(p.stopped).toBe(true);
    expect(w.state()).toMatchObject({ idle: false, draining: true });
    // o lote em andamento fecha 20 s depois e o runTask do filho devolve a tarefa
    await tick(20_000);
    p.exit({ result: 'released', exitCode: 0, signal: null });
    await tick();
    await drained;
    expect(p.signals).toEqual([]);
    expect(deps.release).not.toHaveBeenCalled();
    expect(deps.observe).toHaveBeenCalledWith('exemplo.eco', 'released', expect.any(Number));
    expect(deps.take).toHaveBeenCalledTimes(1);
    expect(queue.map((t) => t.id)).toEqual(['b']);
    expect(w.state()).toMatchObject({ idle: true, draining: true });
  });

  it('prazo da drenagem: SIGTERM no filho e release do pai com o checkpoint', async () => {
    vi.useFakeTimers();
    const { deps, procs } = harness([task('a')], { onStop: 'ignore' });
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'exemplo.eco': 1 }, maxTasks: 1, drainMs: 60_000, killGraceMs: 5000 },
      deps,
    );
    void w.start();
    await tick();
    const drained = w.drain();
    await tick(59_000);
    expect(procs.get('a')!.signals).toEqual([]);
    await tick(1000);
    await drained;
    expect(procs.get('a')!.signals).toEqual(['SIGTERM']);
    expect(deps.release).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(deps.fail).not.toHaveBeenCalled();
    expect(deps.observe).toHaveBeenCalledWith('exemplo.eco', 'released', expect.any(Number));
  });

  it('tarefa tomada depois do SIGTERM volta à fila sem começar', async () => {
    vi.useFakeTimers();
    const { deps } = harness([]);
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'exemplo.eco': 1 }, maxTasks: 1, drainMs: 60_000 },
      deps,
    );
    deps.take.mockImplementationOnce(async () => {
      void w.drain();
      return task('tarde');
    });
    await w.start();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.release).toHaveBeenCalledWith(expect.objectContaining({ id: 'tarde' }));
  });

  it('banco fora ao tomar: espera e tenta de novo', async () => {
    vi.useFakeTimers();
    const { deps } = harness([task('a')]);
    deps.take.mockRejectedValueOnce(new Error('conexão recusada'));
    const w = new TaskWorker(
      { workerId: 'w1', concurrency: { 'exemplo.eco': 1 }, maxTasks: 1, drainMs: 1000, errorBackoffMs: 5000 },
      deps,
    );
    void w.start();
    await tick();
    expect(deps.spawn).not.toHaveBeenCalled();
    await tick(5000);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    void w.drain();
    await tick(10_000);
  });
});
