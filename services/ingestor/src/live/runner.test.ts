import { QuotaExceededError } from '@galaxie/apisports-client';
import { ApiSportsProvider } from '@galaxie/providers';
import { describe, expect, it, vi } from 'vitest';
import { liveWorld, wednesdayNight, type WorldMatch } from '../testing/live-world.js';
import { LiveRunner } from './runner.js';

const MIN = 60_000;

function runnerFor(
  matches: WorldMatch[],
  start: string,
  options: ConstructorParameters<typeof LiveRunner>[0]['options'] = {},
  extra: Partial<ConstructorParameters<typeof LiveRunner>[0]> = {},
) {
  const world = liveWorld({ matches, plan: 'free', start: new Date(start) });
  const runner = new LiveRunner({
    sport: 'football',
    provider: new ApiSportsProvider(world.client, { priority: 'LIVE' }),
    store: world.store,
    governor: world.governor,
    clock: world.clock,
    options,
    ...extra,
  });
  return { world, runner };
}

async function drainBootstrap(world: ReturnType<typeof liveWorld>): Promise<number> {
  let n = 0;
  for (;;) {
    try {
      const t = await world.governor.acquire({
        api: 'football',
        priority: 'BOOTSTRAP',
        endpoint: '/x',
        requestHash: `b${n}`,
      });
      await world.governor.settle(t, 'ok');
      n += 1;
    } catch (err) {
      if (err instanceof QuotaExceededError) return n;
      throw err;
    }
  }
}

describe('LiveRunner', () => {
  it('dia sem jogo relevante: planeja LIVE = 0 e a folga vai para o BOOTSTRAP', async () => {
    const irrelevant = wednesdayNight().filter((m) => m.livePriority === 'none');
    const { world, runner } = runnerFor(irrelevant, '2026-10-21T00:10:00Z');
    const { plan } = await runner.plan();
    expect(plan.quotaPlan).toEqual({ LIVE: 0, DAILY: 40 });
    // 100 − 15 de reserva − 40 do DAILY protegido = 45 para o bootstrap (sem o plano: só 5)
    expect(await drainBootstrap(world)).toBe(45);

    const baseline = liveWorld({
      matches: irrelevant,
      plan: 'free',
      start: new Date('2026-10-21T00:10:00Z'),
    });
    expect(await drainBootstrap(baseline)).toBe(5);
  });

  it('dia com jogos: LIVE protegido (o BOOTSTRAP não come o orçamento do ao vivo)', async () => {
    const { world, runner } = runnerFor(wednesdayNight(), '2026-10-21T00:10:00Z');
    await runner.plan();
    expect(await drainBootstrap(world)).toBe(0);
  });

  it('sai ocioso quando a próxima janela está longe, sem gastar chamadas', async () => {
    const { world, runner } = runnerFor(wednesdayNight(), '2026-10-21T08:00:00Z', { idleExitMs: 15 * MIN });
    const summary = await runner.run();
    expect(summary).toMatchObject({ stoppedBy: 'idle', ticks: 0, calls: 0 });
    expect(world.requests).toHaveLength(0);
  });

  it('para quando o sinal de encerramento chega (SIGTERM)', async () => {
    const { runner } = runnerFor(wednesdayNight(), '2026-10-21T16:40:00Z', { idleExitMs: null });
    const controller = new AbortController();
    controller.abort();
    expect((await runner.run(controller.signal)).stoppedBy).toBe('aborted');
  });

  it('chama o priorizador só quando há mais jogos do que orçamento; falhou → ordem determinística', async () => {
    // 3 jogos espalhados no dia + teto de 6 min: não cabem todos
    const spread: WorldMatch[] = wednesdayNight().filter((m) => [9001, 9002, 9101].includes(m.fixtureId));
    const prioritize = vi.fn().mockResolvedValue(['ev-9002', 'ev-9001', 'ev-9101']);
    const { runner } = runnerFor(spread, '2026-10-21T12:00:00Z', { maxIntervalMs: 6 * MIN }, { prioritize });
    const { plan } = await runner.plan();
    expect(prioritize).toHaveBeenCalledTimes(1);
    expect(prioritize.mock.calls[0]![0]).toMatchObject({ sport: 'football', day: '2026-10-21' });
    expect(plan.included[0]!.candidate.eventId).toBe('ev-9002');
    await runner.plan();
    expect(prioritize).toHaveBeenCalledTimes(1); // mesma situação: não pergunta de novo

    const failing = vi.fn().mockRejectedValue(new Error('LLM fora do ar'));
    const warn = vi.fn();
    const r2 = runnerFor(
      spread,
      '2026-10-21T12:00:00Z',
      { maxIntervalMs: 6 * MIN },
      {
        prioritize: failing,
        log: { info() {}, debug() {}, error() {}, warn },
      },
    );
    const { plan: fallback } = await r2.runner.plan();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    // ordem base: clássico (Palmeiras x Corinthians) primeiro
    expect(fallback.included[0]!.candidate.eventId).toBe('ev-9101');

    const relaxed = vi.fn();
    const r3 = runnerFor(spread, '2026-10-21T12:00:00Z', {}, { prioritize: relaxed });
    await r3.runner.plan();
    expect(relaxed).not.toHaveBeenCalled();
  });
});
