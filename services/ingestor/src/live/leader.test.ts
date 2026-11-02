import { ApiSportsProvider, type ProviderResult } from '@galaxie/providers';
import { describe, expect, it, vi } from 'vitest';
import { liveWorld, wednesdayNight } from '../testing/live-world.js';
import { InMemoryLiveHandoffStore } from './handoff.js';
import {
  DEFAULT_LIVE_LEADER_RETRY_MS,
  liveLeaderSettings,
  runLiveLeadership,
  type LiveLeaderLock,
} from './leader.js';
import { LiveRunner, type LiveClock, type LiveRunnerOptions, type LiveRunSummary } from './runner.js';

const RETRY = 1_000;
const noop = { info() {}, warn() {}, error() {}, debug() {} };

/** Trava falsa: `busy` tentativas devolvem ocupada; `lose()` derruba a conexão de quem a segura. */
class FakeLock implements LiveLeaderLock {
  readonly attempts: number[] = [];
  readonly events: string[] = [];
  busy = 0;
  failures = 0;
  private onLost: (() => void) | undefined;

  constructor(private readonly clock: LiveClock) {}

  async tryAcquire(options: { onLost?: (() => void) | undefined } = {}) {
    this.attempts.push(this.clock.now());
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('banco fora');
    }
    if (this.busy > 0) {
      this.busy -= 1;
      return null;
    }
    this.onLost = options.onLost;
    this.events.push('trava');
    return {
      release: async () => {
        this.events.push('soltou');
      },
    };
  }

  lose(): void {
    this.onLost?.();
  }
}

/** Fornecedor do mundo falso que conta as chamadas e deixa o teste agir no meio do tick. */
class CountingProvider extends ApiSportsProvider {
  calls = 0;
  onCall: ((n: number) => void) | undefined;

  override listLive(...args: Parameters<ApiSportsProvider['listLive']>): Promise<ProviderResult> {
    this.calls += 1;
    this.onCall?.(this.calls);
    return super.listLive(...args);
  }

  override getEventDetail(...args: Parameters<ApiSportsProvider['getEventDetail']>): Promise<ProviderResult> {
    this.calls += 1;
    return super.getEventDetail(...args);
  }
}

function scene(start = '2026-10-21T22:10:00Z') {
  const world = liveWorld({ matches: wednesdayNight(), plan: 'free', start: new Date(start) });
  const provider = new CountingProvider(
    world.client,
    { priority: 'LIVE' },
    () => new Date(world.clock.now()),
  );
  const handoff = new InMemoryLiveHandoffStore();
  const runner = (options: Partial<LiveRunnerOptions>) =>
    new LiveRunner({
      sport: 'football',
      provider,
      store: world.store,
      governor: world.governor,
      clock: world.clock,
      handoff,
      options: { idleExitMs: null, ...options },
    });
  return { world, provider, handoff, runner, lock: new FakeLock(world.clock) };
}

describe('runLiveLeadership', () => {
  it('em espera não chama o fornecedor, tenta a trava a cada retry e assume quando ela solta', async () => {
    const { world, provider, runner, lock } = scene();
    lock.busy = 3;
    const callsWhileWaiting: number[] = [];
    const tryAcquire = lock.tryAcquire.bind(lock);
    vi.spyOn(lock, 'tryAcquire').mockImplementation(async (options) => {
      callsWhileWaiting.push(provider.calls);
      return tryAcquire(options);
    });

    const summary = await runLiveLeadership(
      {
        lock,
        instance: 'b',
        retryMs: RETRY,
        clock: world.clock,
        log: noop,
        term: (signal, fence) => runner({ maxTicks: 1 }).run(signal, fence),
      },
      new AbortController().signal,
    );

    expect(callsWhileWaiting).toEqual([0, 0, 0, 0]);
    expect(lock.attempts.length).toBe(4);
    expect(summary).toMatchObject({ stoppedBy: 'max_ticks', ticks: 1 });
    expect(provider.calls).toBe(1);
    expect(lock.events).toEqual(['trava', 'soltou']);
  });

  it('o intervalo entre as tentativas é o retry configurado', async () => {
    const { world, lock } = scene();
    lock.busy = 3;
    const controller = new AbortController();
    const term = vi.fn(async () => {
      controller.abort();
      return { stoppedBy: 'aborted' } as LiveRunSummary;
    });
    await runLiveLeadership(
      { lock, instance: 'b', retryMs: RETRY, clock: world.clock, log: noop, term },
      controller.signal,
    );
    const gaps = lock.attempts.slice(1).map((at, i) => at - lock.attempts[i]!);
    expect(gaps).toEqual([RETRY, RETRY, RETRY]);
    expect(term).toHaveBeenCalledTimes(1);
  });

  it('SIGTERM em espera sai sem nunca ter sido líder', async () => {
    const { world, lock } = scene();
    lock.busy = Infinity;
    const controller = new AbortController();
    const sleep = vi.spyOn(world.clock, 'sleep').mockImplementation(async () => controller.abort());
    const term = vi.fn();
    const summary = await runLiveLeadership(
      { lock, instance: 'b', retryMs: RETRY, clock: world.clock, log: noop, term },
      controller.signal,
    );
    expect(summary).toBeNull();
    expect(term).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('perdeu a trava no meio do tick: descarta o resultado, não chama em espera e o próximo mandato lê o bastão', async () => {
    const { world, provider, runner, lock } = scene();
    const applyBatch = vi.spyOn(world.store, 'applyBatch');
    const summaries: LiveRunSummary[] = [];
    const applied: number[] = [];
    const callsWhileWaiting: number[] = [];
    // a trava cai durante a 3ª chamada: a resposta chega a uma cópia que já não é líder
    provider.onCall = (n) => {
      if (n === 3) {
        lock.busy = 2;
        lock.lose();
      }
    };
    const tryAcquire = lock.tryAcquire.bind(lock);
    vi.spyOn(lock, 'tryAcquire').mockImplementation(async (options) => {
      callsWhileWaiting.push(provider.calls);
      return tryAcquire(options);
    });

    await runLiveLeadership(
      {
        lock,
        instance: 'a',
        retryMs: RETRY,
        clock: world.clock,
        log: noop,
        term: async (signal, fence) => {
          // o 1º mandato só termina pela perda da trava
          const summary = await runner(summaries.length ? { maxTicks: 2 } : {}).run(signal, fence);
          summaries.push(summary);
          applied.push(applyBatch.mock.calls.length);
          return summary;
        },
      },
      new AbortController().signal,
    );

    expect(summaries.map((s) => s.stoppedBy)).toEqual(['lost', 'max_ticks']);
    // 1º mandato: 2 ticks valem; o 3º foi chamado mas não gravou nem contou
    expect(summaries[0]!.ticks).toBe(2);
    expect(applied[0]).toBe(2);
    // em espera: nada de chamada a mais entre a perda e o novo mandato
    expect(callsWhileWaiting).toEqual([0, 3, 3, 3]);
    expect(lock.events).toEqual(['trava', 'soltou', 'trava', 'soltou']);
    // o 2º mandato continuou do bastão: o primeiro tick dele já mede o intervalo desde o último da líder anterior
    expect(summaries[1]!.gaps).toHaveLength(summaries[1]!.ticks);
  });

  it('SIGTERM: termina o tick em andamento, registra e só então solta a trava', async () => {
    const { world, provider, handoff, runner, lock } = scene();
    const controller = new AbortController();
    const applyBatch = vi.spyOn(world.store, 'applyBatch');
    provider.onCall = (n) => {
      if (n === 2) controller.abort();
    };
    const summary = await runLiveLeadership(
      {
        lock,
        instance: 'a',
        retryMs: RETRY,
        clock: world.clock,
        log: noop,
        term: async (signal, fence) => {
          const s = await runner({}).run(signal, fence);
          lock.events.push('job_run');
          return s;
        },
      },
      controller.signal,
    );
    expect(summary).toMatchObject({ stoppedBy: 'aborted', ticks: 2 });
    expect(applyBatch).toHaveBeenCalledTimes(2);
    expect(provider.calls).toBe(2);
    expect(lock.events).toEqual(['trava', 'job_run', 'soltou']);
    expect((await handoff.load('football'))?.lastTickAt).toBe(new Date(world.clock.now()).toISOString());
  });

  it('erro no mandato: solta a trava e propaga (a outra cópia assume, o scheduler religa esta)', async () => {
    const { world, lock } = scene();
    await expect(
      runLiveLeadership(
        {
          lock,
          instance: 'a',
          retryMs: RETRY,
          clock: world.clock,
          log: noop,
          term: () => Promise.reject(new Error('ao vivo desistiu')),
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('ao vivo desistiu');
    expect(lock.events).toEqual(['trava', 'soltou']);
  });

  it('erro depois de perder a trava é consequência: volta para a espera em vez de derrubar a cópia', async () => {
    const { world, lock } = scene();
    const controller = new AbortController();
    const term = vi
      .fn<(s: AbortSignal, f: AbortSignal) => Promise<LiveRunSummary>>()
      .mockImplementationOnce(() => {
        lock.lose();
        return Promise.reject(new Error('banco fora'));
      })
      .mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve({ stoppedBy: 'aborted' } as LiveRunSummary);
      });
    const warn = vi.fn();
    const summary = await runLiveLeadership(
      { lock, instance: 'a', retryMs: RETRY, clock: world.clock, log: { ...noop, warn }, term },
      controller.signal,
    );
    expect(summary).toMatchObject({ stoppedBy: 'aborted' });
    expect(term).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.anything(),
      'mandato terminou com erro depois de perder a trava',
    );
  });

  it('banco fora ao disputar a trava: avisa uma vez por queda e segue tentando', async () => {
    const { world, lock } = scene();
    lock.failures = 3;
    const controller = new AbortController();
    const warn = vi.fn();
    const term = vi.fn(async () => {
      controller.abort();
      return { stoppedBy: 'aborted' } as LiveRunSummary;
    });
    await runLiveLeadership(
      { lock, instance: 'a', retryMs: RETRY, clock: world.clock, log: { ...noop, warn }, term },
      controller.signal,
    );
    expect(lock.attempts).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(term).toHaveBeenCalledTimes(1);
  });
});

describe('bastão entre líder e reserva', () => {
  it('a nova líder espera o intervalo desde o último tick da antiga: não repete a chamada', async () => {
    const { world, provider, runner } = scene();
    const first = await runner({ maxTicks: 2 }).run();
    expect(first.ticks).toBe(2);
    const lastTickAt = world.requests.at(-1)!.at.getTime();

    const second = await runner({ maxTicks: 1 }).run();
    expect(provider.calls).toBe(3);
    const gap = world.requests.at(-1)!.at.getTime() - lastTickAt;
    expect(gap).toBeGreaterThanOrEqual(15_000);
    expect(second.gaps).toEqual([gap]);
  });

  it('o orçamento do dia é o mesmo em qualquer cópia: vem do ledger, não da memória', async () => {
    const { world, runner } = scene();
    await runner({ maxTicks: 3 }).run();
    const now = new Date(world.clock.now());
    const a = await runner({}).plan(now);
    const b = await runner({}).plan(now);
    expect(b.plan.budget).toEqual(a.plan.budget);
    expect(a.plan.budget.liveUsed).toBe((await world.governor.usage('football', a.plan.day)).used.LIVE);
    expect(a.plan.budget.liveUsed).toBe(3);
  });

  it('backoff de falha e intervalo sobrevivem à troca de cópia', async () => {
    const { handoff, runner, world } = scene();
    const until = new Date(world.clock.now() + 10 * 60_000);
    await handoff.save('football', {
      lastTickAt: new Date(world.clock.now() - 1_000).toISOString(),
      backoffUntil: until.toISOString(),
      consecutiveFailures: 4,
      halftimeSeenAt: {},
      finalizeAttempts: {},
    });
    await runner({ maxTicks: 1 }).run();
    // a nova líder respeitou o backoff da anterior antes de chamar
    expect(world.requests[0]!.at.getTime()).toBeGreaterThanOrEqual(until.getTime());
  });

  it('sem bastão legível, começa do zero em vez de parar o ao vivo', async () => {
    const { handoff, runner, provider } = scene();
    vi.spyOn(handoff, 'load').mockRejectedValue(new Error('banco fora'));
    expect((await runner({ maxTicks: 1 }).run()).ticks).toBe(1);
    expect(provider.calls).toBe(1);
  });
});

describe('liveLeaderSettings', () => {
  it('desligado por padrão: o comportamento de hoje não muda', () => {
    expect(liveLeaderSettings({})).toMatchObject({
      enabled: false,
      retryMs: DEFAULT_LIVE_LEADER_RETRY_MS,
    });
    expect(liveLeaderSettings({ LIVE_LEADER: 'off' }).enabled).toBe(false);
    expect(liveLeaderSettings({ LIVE_LEADER: ' ' }).enabled).toBe(false);
  });

  it('liga por variável, com o retry e a cópia configuráveis', () => {
    expect(
      liveLeaderSettings({ LIVE_LEADER: 'on', LIVE_LEADER_RETRY_MS: '250', HOSTNAME: 'abc123' }),
    ).toEqual({ enabled: true, retryMs: 250, instance: 'abc123' });
  });

  it('valor inválido falha na partida, em vez de subir sem eleição', () => {
    expect(() => liveLeaderSettings({ LIVE_LEADER: 'sim' })).toThrow(/LIVE_LEADER deve ser on ou off/);
    expect(() => liveLeaderSettings({ LIVE_LEADER: 'on', LIVE_LEADER_RETRY_MS: '0' })).toThrow(
      /LIVE_LEADER_RETRY_MS/,
    );
    expect(() => liveLeaderSettings({ LIVE_LEADER: 'on', LIVE_LEADER_RETRY_MS: 'x' })).toThrow(
      /LIVE_LEADER_RETRY_MS/,
    );
  });
});
