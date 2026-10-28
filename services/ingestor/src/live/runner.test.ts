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
    // relógio do cenário também no provedor (horário dos erros), senão o teste depende da data real
    provider: new ApiSportsProvider(world.client, { priority: 'LIVE' }, () => new Date(world.clock.now())),
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
    // 100 − 15 de reserva − 40 do DAILY protegido = 45 para o bootstrap (sem o plano: só 20, porque abaixo
    // de 85 ficam protegidos também os 40 − 15 do ao vivo que a reserva não cobre)
    expect(await drainBootstrap(world)).toBe(45);

    const baseline = liveWorld({
      matches: irrelevant,
      plan: 'free',
      start: new Date('2026-10-21T00:10:00Z'),
    });
    expect(await drainBootstrap(baseline)).toBe(20);
  });

  it('dia com jogos: LIVE protegido (o BOOTSTRAP não come o orçamento do ao vivo)', async () => {
    const { world, runner } = runnerFor(wednesdayNight(), '2026-10-21T00:10:00Z');
    const { plan } = await runner.plan();
    // abaixo de 85 ficam protegidos o DAILY e o que a reserva de 15 (só do ao vivo) não cobre do plano do LIVE
    const bootstrap = await drainBootstrap(world);
    expect(bootstrap).toBe(Math.max(0, 85 - plan.quotaPlan.DAILY - (plan.quotaPlan.LIVE - 15)));
    // o ao vivo ainda tem o plano inteiro: a parte protegida mais a reserva
    expect(100 - bootstrap - plan.quotaPlan.DAILY).toBeGreaterThanOrEqual(plan.quotaPlan.LIVE);
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

  it('relê a configuração durante a execução: destaque ligado no meio passa a valer no próximo plano', async () => {
    let featured: 'off' | 'on' = 'off';
    const load = vi.fn(async () => ({ featured, protectDaily: undefined }));
    const { runner } = runnerFor(
      wednesdayNight(),
      '2026-10-21T16:50:00Z',
      { idleExitMs: null, featured: 'off', protectDaily: 30, until: new Date('2026-10-21T17:20:00Z') },
      { refresh: { everyMs: MIN, load } },
    );
    await runner.refreshOptions();
    expect(runner.settings).toMatchObject({ featured: 'off' });
    // LIVE_PROTECT_DAILY apagado no painel: volta ao comportamento padrão (sem piso fixo)
    expect(runner.settings.protectDaily).toBeUndefined();
    expect((await runner.plan()).plan.featured).toBe(false);

    featured = 'on';
    await runner.refreshOptions(); // antes do intervalo: não relê
    expect(load).toHaveBeenCalledTimes(1);
    const summary = await runner.run(undefined);
    expect(load.mock.calls.length).toBeGreaterThan(1);
    expect(runner.settings.featured).toBe('on');
    expect([...summary.plans.values()].some((p) => p.featured)).toBe(true);
  });

  it('erro ao planejar (banco fora) ou no gancho do tick não derruba o ao vivo', async () => {
    const error = vi.fn();
    const warn = vi.fn();
    const onTick = vi.fn().mockRejectedValueOnce(new Error('gancho quebrado'));
    const { world, runner } = runnerFor(
      wednesdayNight(),
      '2026-10-21T16:50:00Z',
      { idleExitMs: null, until: new Date('2026-10-21T17:20:00Z') },
      { log: { info() {}, debug() {}, error, warn }, hooks: { onTick } },
    );
    vi.spyOn(world.store, 'candidates')
      .mockRejectedValueOnce(new Error('banco fora'))
      .mockRejectedValueOnce(new Error('banco fora'));
    const summary = await runner.run();
    expect(summary.stoppedBy).toBe('until');
    expect(summary.errors).toBeGreaterThanOrEqual(2);
    expect(error).toHaveBeenCalledWith(expect.anything(), 'falha ao planejar o ao vivo; tentando de novo');
    // seguiu acompanhando depois das falhas
    expect(summary.ticks).toBeGreaterThan(1);
    expect(onTick.mock.calls.length).toBe(summary.ticks);
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'falha no gancho do tick ao vivo; seguindo');
  });

  it('erro que não passa (ex.: bug, banco fora de vez): desiste depois de N seguidos e o job sai com erro', async () => {
    const { world, runner } = runnerFor(
      wednesdayNight(),
      '2026-10-21T16:50:00Z',
      { idleExitMs: null, until: new Date('2026-10-21T20:00:00Z'), maxConsecutiveErrors: 3 },
      { log: { info() {}, debug() {}, error() {}, warn() {} } },
    );
    const candidates = vi
      .spyOn(world.store, 'candidates')
      .mockRejectedValue(new Error('relation does not exist'));
    await expect(runner.run()).rejects.toThrow(
      /desistiu depois de 3 erros seguidos ao planejar: relation does not exist/,
    );
    expect(candidates).toHaveBeenCalledTimes(3);
  });

  it('tick que sempre falha (o wait entre os ticks não zera a contagem): desiste depois de N seguidos', async () => {
    const { runner } = runnerFor(
      wednesdayNight(),
      '2026-10-21T16:50:00Z',
      { idleExitMs: null, until: new Date('2026-10-21T23:00:00Z'), maxConsecutiveErrors: 3 },
      { log: { info() {}, debug() {}, error() {}, warn() {} } },
    );
    const poller = (runner as unknown as { poller: { tick: (...args: unknown[]) => Promise<unknown> } })
      .poller;
    const tick = vi.spyOn(poller, 'tick').mockRejectedValue(new Error('insert falhou'));
    await expect(runner.run()).rejects.toThrow(/desistiu depois de 3 erros seguidos no tick: insert falhou/);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('falha ao reler a configuração mantém a atual', async () => {
    const { runner } = runnerFor(
      wednesdayNight(),
      '2026-10-21T16:50:00Z',
      { featured: 'auto' },
      {
        refresh: { everyMs: MIN, load: async () => Promise.reject(new Error('banco fora')) },
      },
    );
    await runner.refreshOptions();
    expect(runner.settings.featured).toBe('auto');
  });
});
