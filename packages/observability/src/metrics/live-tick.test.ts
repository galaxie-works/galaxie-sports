import type { Database } from '@galaxie/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import {
  liveTickSamples,
  parseLiveTick,
  registerLiveTickMetrics,
  type LiveTickCursor,
  type LiveTickRow,
} from './live-tick.js';

const NOW = new Date('2026-11-03T20:00:00Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();
const ahead = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();

const tick = (over: Partial<LiveTickCursor> = {}): LiveTickCursor => ({
  instance: 'a',
  updatedAt: ago(5),
  lastTickAt: ago(5),
  lastIntervalSeconds: 15.1,
  recent: [
    { at: ago(280), seconds: 40 },
    { at: ago(120), seconds: 15 },
    { at: ago(20), seconds: 15.1 },
  ],
  plannedIntervalSeconds: 15,
  pausedUntil: null,
  ...over,
});

const open = [{ start: ago(600), end: ahead(3600) }];

describe('parseLiveTick', () => {
  it('lê o registro e descarta o que não for número ou data', () => {
    expect(
      parseLiveTick({
        instance: 'a',
        updatedAt: ago(1),
        lastTickAt: ago(2),
        lastIntervalSeconds: 15,
        recent: [{ at: ago(3), seconds: 15 }, { at: 'ontem', seconds: 15 }, { at: ago(4) }, 7],
        plannedIntervalSeconds: 'quinze',
        pausedUntil: null,
      }),
    ).toMatchObject({
      instance: 'a',
      lastTickAt: ago(2),
      lastIntervalSeconds: 15,
      recent: [{ at: ago(3), seconds: 15 }],
      plannedIntervalSeconds: null,
      pausedUntil: null,
    });
    expect(parseLiveTick(null)).toBeNull();
    expect(parseLiveTick('x')).toBeNull();
  });
});

describe('liveTickSamples', () => {
  it('idade do último tick, intervalo, maior intervalo dos últimos 5 min e janela aberta', () => {
    const rows: LiveTickRow[] = [{ sport: 'football', tick: tick(), segments: open }];
    expect(liveTickSamples(rows, NOW)).toEqual([
      {
        sport: 'football',
        lastTickAgeSeconds: 5,
        intervalSeconds: 15.1,
        intervalMaxSeconds: 40,
        plannedIntervalSeconds: 15,
        windowOpen: true,
        paused: false,
      },
    ]);
  });

  it('a idade cresce com o relógio da coleta, não com a gravação', () => {
    const rows: LiveTickRow[] = [{ sport: 'football', tick: tick(), segments: open }];
    const later = new Date(NOW.getTime() + 55_000);
    expect(liveTickSamples(rows, later)[0]!.lastTickAgeSeconds).toBe(60);
  });

  it('intervalo fora dos 5 min não entra no maior intervalo', () => {
    const rows: LiveTickRow[] = [
      { sport: 'football', tick: tick({ recent: [{ at: ago(400), seconds: 90 }] }), segments: open },
    ];
    expect(liveTickSamples(rows, NOW)[0]!.intervalMaxSeconds).toBeNull();
  });

  it('janela fechada, fora do dia ou sem plano: janela aberta = false', () => {
    const closed = [{ start: ago(7200), end: ago(60) }];
    const future = [{ start: ahead(60), end: ahead(7200) }];
    expect(liveTickSamples([{ sport: 'football', tick: tick(), segments: closed }], NOW)[0]!.windowOpen).toBe(
      false,
    );
    expect(liveTickSamples([{ sport: 'football', tick: tick(), segments: future }], NOW)[0]!.windowOpen).toBe(
      false,
    );
    expect(liveTickSamples([{ sport: 'football', tick: tick(), segments: null }], NOW)[0]!.windowOpen).toBe(
      false,
    );
    // o fim da janela é exclusivo, como no decideTick
    const edge = [{ start: ago(60), end: NOW.toISOString() }];
    expect(liveTickSamples([{ sport: 'football', tick: tick(), segments: edge }], NOW)[0]!.windowOpen).toBe(
      false,
    );
  });

  it('pausa de propósito vale até o fim dela', () => {
    const during = liveTickSamples(
      [{ sport: 'football', tick: tick({ pausedUntil: ahead(300) }), segments: open }],
      NOW,
    );
    expect(during[0]!.paused).toBe(true);
    // durante a pausa o tick ainda não é devido: idade 0
    expect(during[0]!.lastTickAgeSeconds).toBe(0);
    const after = liveTickSamples(
      [{ sport: 'football', tick: tick({ pausedUntil: ago(1) }), segments: open }],
      NOW,
    );
    expect(after[0]!.paused).toBe(false);
  });

  it('depois do meio-tempo a idade conta desde o fim da pausa, não desde o tick de antes', () => {
    // último tick há 11 min; a pausa de 10 min acabou há 1 s: o tick que volta tem 1 s de atraso, não 11 min
    const [s] = liveTickSamples(
      [{ sport: 'football', tick: tick({ lastTickAt: ago(660), pausedUntil: ago(1) }), segments: open }],
      NOW,
    );
    expect(s!.lastTickAgeSeconds).toBe(1);
    // e se o tick não volta, a idade segue crescendo a partir do fim da pausa
    const [late] = liveTickSamples(
      [{ sport: 'football', tick: tick({ lastTickAt: ago(900), pausedUntil: ago(75) }), segments: open }],
      NOW,
    );
    expect(late!.lastTickAgeSeconds).toBe(75);
  });

  it('sem registro de tick: janela existe, idade e intervalos não', () => {
    const [s] = liveTickSamples([{ sport: 'football', tick: null, segments: open }], NOW);
    expect(s).toMatchObject({
      lastTickAgeSeconds: null,
      intervalSeconds: null,
      intervalMaxSeconds: null,
      plannedIntervalSeconds: 0,
      windowOpen: true,
    });
  });
});

/** Banco falso: devolve linhas conforme a consulta (a do ritmo ou a das cópias que disputam a liderança). */
function fakeDb(rows: unknown[], leaders: unknown[]) {
  const dialect = new PgDialect();
  const execute = vi.fn(async (query: SQL) => {
    const text = dialect.sqlToQuery(query).sql;
    return text.includes('pg_stat_activity') ? leaders : rows;
  });
  return { db: { execute } as unknown as Database, execute };
}

describe('registerLiveTickMetrics', () => {
  const stateRow = { sport: 'football', key: 'state', cursor: { segments: open } };
  const tickRow = { sport: 'football', key: 'tick', cursor: tick() };

  async function scrape(db: Database, onCollectorError?: (c: string, e: unknown) => void) {
    const registry = new Registry();
    registerLiveTickMetrics(registry, db, { now: () => NOW, cacheMs: 0, onCollectorError });
    return registry.metrics();
  }

  it('expõe o ritmo do ao vivo e quem lidera, sem o prefixo galaxie_', async () => {
    const { db } = fakeDb(
      [stateRow, tickRow],
      [
        { application_name: 'galaxie-live-leader:ingestor-1', leader: true },
        { application_name: 'galaxie-live-leader:ingestor-2', leader: false },
      ],
    );
    const text = await scrape(db);
    expect(text).toContain('live_last_tick_age_seconds{sport="football"} 5\n');
    expect(text).toContain('live_tick_interval_seconds{sport="football"} 15.1\n');
    expect(text).toContain('live_tick_interval_max_seconds{sport="football"} 40\n');
    expect(text).toContain('live_tick_planned_interval_seconds{sport="football"} 15\n');
    expect(text).toContain('live_tick_paused{sport="football"} 0\n');
    expect(text).toContain('live_window_open{sport="football"} 1\n');
    expect(text).toContain('live_leader{instance="ingestor-1"} 1\n');
    expect(text).toContain('live_leader{instance="ingestor-2"} 0\n');
  });

  it('sem LIVE_LEADER=on ninguém disputa: sem série live_leader', async () => {
    const { db } = fakeDb([stateRow, tickRow], []);
    const text = await scrape(db);
    expect(text).not.toMatch(/^live_leader\{/m);
    expect(text).toContain('live_window_open{sport="football"} 1');
  });

  it('banco fora: sem séries (o alerta de coletor é do /metrics da API) e o erro vai para o log', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('banco fora'));
    const onError = vi.fn();
    const text = await scrape({ execute } as unknown as Database, onError);
    expect(text).not.toContain('live_last_tick_age_seconds{');
    expect(onError).toHaveBeenCalledWith('live_tick', expect.any(Error));
  });

  it('cache curto: duas coletas seguidas leem o banco uma vez', async () => {
    const { db, execute } = fakeDb([stateRow, tickRow], []);
    const registry = new Registry();
    registerLiveTickMetrics(registry, db, { now: () => NOW, cacheMs: 60_000 });
    await registry.metrics();
    await registry.metrics();
    expect(execute).toHaveBeenCalledTimes(2); // uma coleta = a consulta do ritmo e a das cópias
  });
});
