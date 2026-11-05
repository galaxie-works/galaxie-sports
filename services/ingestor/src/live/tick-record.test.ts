import { describe, expect, it } from 'vitest';
import type { LiveTickCursor } from '@galaxie/observability';
import { ApiSportsProvider } from '@galaxie/providers';
import { liveWorld, wednesdayNight } from '../testing/live-world.js';
import { InMemoryLiveHandoffStore } from './handoff.js';
import { LiveRunner, type LiveRunnerOptions } from './runner.js';
import {
  emptyLiveTick,
  InMemoryLiveTickStore,
  liveTickKey,
  liveTickNeedsSave,
  liveTickSaved,
  MAX_COUNTED_GAP_MS,
  recordLivePace,
  recordLiveTick,
} from './tick-record.js';

const at = (iso: string) => new Date(iso);
const T0 = at('2026-10-21T22:10:00Z');
const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

describe('recordLiveTick', () => {
  it('o primeiro tick não tem intervalo; os seguintes medem desde o anterior', () => {
    const first = recordLiveTick(null, T0, 'a', 15);
    expect(first).toMatchObject({
      instance: 'a',
      lastTickAt: T0.toISOString(),
      lastIntervalSeconds: null,
      plannedIntervalSeconds: 15,
      pausedUntil: null,
      recent: [],
    });
    const second = recordLiveTick(first, plus(T0, 15.04), 'a', 15);
    expect(second.lastIntervalSeconds).toBe(15);
    expect(second.recent).toEqual([{ at: plus(T0, 15.04).toISOString(), seconds: 15 }]);
  });

  it('o intervalo atravessa a troca de cópia: quem assume mede desde o último tick de quem saiu', () => {
    const old = recordLiveTick(recordLiveTick(null, T0, 'a', 15), plus(T0, 15), 'a', 15);
    const next = recordLiveTick(old, plus(T0, 27), 'b', 15);
    expect(next.instance).toBe('b');
    expect(next.lastIntervalSeconds).toBe(12);
  });

  it('pausa de propósito entre os ticks (meio-tempo, orçamento, entre janelas) não vira intervalo', () => {
    const tick = recordLiveTick(null, T0, 'a', 15);
    const paused = recordLivePace(tick, { pausedUntil: plus(T0, 600) }, plus(T0, 20), 'a');
    const resumed = recordLiveTick(paused, plus(T0, 600), 'a', 15);
    expect(resumed.lastIntervalSeconds).toBeNull();
    expect(resumed.recent).toEqual([]);
    expect(resumed.pausedUntil).toBeNull();
    // e o intervalo seguinte volta a ser medido
    expect(recordLiveTick(resumed, plus(T0, 615), 'a', 15).lastIntervalSeconds).toBe(15);
  });

  it('intervalo maior que 30 min é outra janela ou queda longa, não ritmo', () => {
    const tick = recordLiveTick(null, T0, 'a', 15);
    const later = recordLiveTick(tick, new Date(T0.getTime() + MAX_COUNTED_GAP_MS + 1_000), 'a', 15);
    expect(later.lastIntervalSeconds).toBeNull();
    expect(later.lastTickAt).toBe(new Date(T0.getTime() + MAX_COUNTED_GAP_MS + 1_000).toISOString());
  });

  it('guarda só os intervalos dos últimos 5 minutos', () => {
    let tick = recordLiveTick(null, T0, 'a', 15);
    for (let i = 1; i <= 30; i += 1) tick = recordLiveTick(tick, plus(T0, i * 15), 'a', 15);
    expect(tick.recent.length).toBeLessThanOrEqual(21);
    const oldest = Date.parse(tick.recent[0]!.at);
    expect(Date.parse(tick.lastTickAt!) - oldest).toBeLessThanOrEqual(5 * 60_000);
  });

  it('sem intervalo planejado novo mantém o anterior', () => {
    const tick = recordLiveTick(null, T0, 'a', 45);
    expect(recordLiveTick(tick, plus(T0, 45), 'a', null).plannedIntervalSeconds).toBe(45);
  });
});

describe('recordLivePace e liveTickKey', () => {
  it('muda o intervalo planejado e a pausa sem mexer no último tick', () => {
    const tick = recordLiveTick(null, T0, 'a', 15);
    const until = plus(T0, 600);
    const paused = recordLivePace(tick, { pausedUntil: until }, plus(T0, 20), 'a');
    expect(paused).toMatchObject({ lastTickAt: tick.lastTickAt, pausedUntil: until.toISOString() });
    expect(paused.plannedIntervalSeconds).toBe(15);
    const resumed = recordLivePace(
      paused,
      { plannedIntervalSeconds: 30, pausedUntil: null },
      plus(T0, 700),
      'a',
    );
    expect(resumed).toMatchObject({ plannedIntervalSeconds: 30, pausedUntil: null });
  });

  it('intervalo planejado que sobe de verdade é gravado antes do tick atrasado; ajuste pequeno ou queda espera', () => {
    const tick = recordLiveTick(null, T0, 'a', 15);
    const saved = liveTickSaved(tick);
    const planned = (s: number) =>
      recordLivePace(tick, { plannedIntervalSeconds: s, pausedUntil: null }, plus(T0, 5), 'a');
    expect(liveTickNeedsSave(tick, null)).toBe(true);
    expect(liveTickNeedsSave(tick, saved)).toBe(false);
    // a reserva que assume vê o plano 5 s maior: não vale uma transação a menos de 2 s da primeira chamada
    expect(liveTickNeedsSave(planned(20), saved)).toBe(false);
    expect(liveTickNeedsSave(planned(25), saved)).toBe(false);
    // 15 s -> 5 min (replanejou ou o painel mudou): sem gravar, o SLO e o LiveTickGap veriam buraco aos 30 s e 60 s
    expect(liveTickNeedsSave(planned(300), saved)).toBe(true);
    // encurtou: o limite antigo é mais folgado, nenhum alarme falso
    expect(liveTickNeedsSave(planned(5), liveTickSaved(planned(300)))).toBe(false);
    // pausa nova sempre grava
    expect(
      liveTickNeedsSave(recordLivePace(tick, { pausedUntil: plus(T0, 600) }, plus(T0, 5), 'a'), saved),
    ).toBe(true);
  });

  it('a chave só muda com um tick novo ou com a pausa; o intervalo planejado espera o próximo tick', () => {
    const tick = recordLiveTick(null, T0, 'a', 15);
    expect(liveTickKey(recordLivePace(tick, { pausedUntil: null }, plus(T0, 5), 'a'))).toBe(
      liveTickKey(tick),
    );
    expect(
      liveTickKey(recordLivePace(tick, { plannedIntervalSeconds: 40, pausedUntil: null }, plus(T0, 5), 'a')),
    ).toBe(liveTickKey(tick));
    expect(liveTickKey(recordLivePace(tick, { pausedUntil: plus(T0, 99) }, plus(T0, 5), 'a'))).not.toBe(
      liveTickKey(tick),
    );
    expect(liveTickKey(emptyLiveTick('a', T0))).not.toBe(liveTickKey(tick));
  });
});

function scene(start = '2026-10-21T22:10:00Z') {
  const world = liveWorld({ matches: wednesdayNight(), plan: 'free', start: new Date(start) });
  const provider = new ApiSportsProvider(
    world.client,
    { priority: 'LIVE' },
    () => new Date(world.clock.now()),
  );
  const tickRecord = new InMemoryLiveTickStore();
  const handoff = new InMemoryLiveHandoffStore();
  const runner = (
    options: Partial<LiveRunnerOptions>,
    instance = 'a',
    useHandoff = true,
    extra: Partial<ConstructorParameters<typeof LiveRunner>[0]> = {},
  ) =>
    new LiveRunner({
      sport: 'football',
      provider,
      store: world.store,
      governor: world.governor,
      clock: world.clock,
      tickRecord,
      instance,
      ...(useHandoff ? { handoff } : {}),
      options: { idleExitMs: null, ...options },
      ...extra,
    });
  return { world, tickRecord, runner };
}

describe('LiveRunner grava o ritmo do ao vivo', () => {
  it('a cada tick: hora do último tick, intervalo medido e intervalo do plano', async () => {
    const { world, tickRecord, runner } = scene();
    const summary = await runner({ maxTicks: 4 }).run();
    expect(summary.ticks).toBe(4);
    const saved = (await tickRecord.load('football'))!;
    expect(saved.instance).toBe('a');
    expect(saved.lastTickAt).toBe(world.requests.at(-1)!.at.toISOString());
    expect(saved.lastIntervalSeconds).toBeCloseTo(summary.gaps.at(-1)! / 1000, 1);
    expect(saved.lastIntervalSeconds).toBeGreaterThanOrEqual(15);
    expect(saved.plannedIntervalSeconds).toBeGreaterThanOrEqual(15);
    expect(saved.pausedUntil).toBeNull();
    // o cenário é de plano grátis (ticks de ~3 min): só os dois últimos intervalos cabem nos 5 min guardados
    expect(saved.recent.map((r) => r.seconds)).toEqual(
      summary.gaps.slice(-2).map((g) => Math.round(g / 100) / 10),
    );
  });

  it('a troca de cópia aparece no intervalo: quem assume mede desde o último tick de quem saiu', async () => {
    const { world, tickRecord, runner } = scene();
    await runner({ maxTicks: 2 }, 'a').run();
    const lastOfA = world.requests.at(-1)!.at.getTime();
    // a nova cópia leva 40 s para assumir (SIGTERM, trava, partida) e o runner da outra não está mais no ar
    await world.clock.sleep(40_000);
    await runner({ maxTicks: 1 }, 'b').run();
    const saved = (await tickRecord.load('football'))!;
    expect(saved.instance).toBe('b');
    const gap = (world.requests.at(-1)!.at.getTime() - lastOfA) / 1000;
    expect(gap).toBeGreaterThanOrEqual(15);
    expect(saved.lastIntervalSeconds).toBeCloseTo(gap, 1);
  });

  it('sem líder e reserva (sem bastão) o intervalo também atravessa a reinicialização do processo', async () => {
    const { world, tickRecord, runner } = scene();
    await runner({ maxTicks: 2 }, 'a', false).run();
    const lastOfA = world.requests.at(-1)!.at.getTime();
    await world.clock.sleep(70_000);
    await runner({ maxTicks: 1 }, 'a', false).run();
    // sem bastão o novo processo tica na hora; o intervalo medido é o da pausa entre os dois processos
    const saved = (await tickRecord.load('football'))!;
    expect(saved.lastIntervalSeconds).toBeCloseTo((world.requests.at(-1)!.at.getTime() - lastOfA) / 1000, 1);
  });

  it('antes da janela o runner está em pausa de propósito até o início dela', async () => {
    const { tickRecord, runner } = scene('2026-10-21T08:00:00Z');
    const summary = await runner({ idleExitMs: 15 * 60_000 }).run();
    expect(summary).toMatchObject({ stoppedBy: 'idle', ticks: 0 });
    const saved = (await tickRecord.load('football'))!;
    expect(saved.lastTickAt).toBeNull();
    expect(Date.parse(saved.pausedUntil!)).toBeGreaterThan(Date.parse('2026-10-21T08:00:00Z'));
  });

  it('plano que passa a pedir intervalo bem maior grava o intervalo novo antes do tick atrasado', async () => {
    const { tickRecord, runner } = scene();
    const saves: { planned: number | null; lastTickAt: string | null }[] = [];
    const save = tickRecord.save.bind(tickRecord);
    tickRecord.save = async (sport: string, tick: LiveTickCursor) => {
      saves.push({ planned: tick.plannedIntervalSeconds, lastTickAt: tick.lastTickAt });
      return save(sport, tick);
    };
    // depois do primeiro tick o painel passa a proteger mais cota do DAILY: o orçamento do ao vivo encolhe e o
    // intervalo do plano cresce; o runner espera o intervalo novo e o ritmo gravado já tem de dizer isso
    const panel: { protectDaily: number | undefined } = { protectDaily: undefined };
    const load = async () => ({ protectDaily: panel.protectDaily });
    await runner({ maxTicks: 1 }, 'a', true, { refresh: { everyMs: 1, load } }).run();
    const first = saves.at(-1)!;
    panel.protectDaily = 70;
    const second = runner({ maxTicks: 2 }, 'a', true, { refresh: { everyMs: 1, load } });
    saves.length = 0;
    await second.run();
    const beforeNextTick = saves.find(
      (s) => s.lastTickAt === first.lastTickAt && s.planned !== first.planned,
    );
    expect(beforeNextTick?.planned).toBeGreaterThan((first.planned ?? 0) + 10);
  });

  it('falha ao gravar o ritmo não derruba o ao vivo', async () => {
    const { tickRecord, runner } = scene();
    tickRecord.save = async () => {
      throw new Error('banco fora');
    };
    const summary = await runner({ maxTicks: 2 }).run();
    expect(summary.ticks).toBe(2);
  });
});
