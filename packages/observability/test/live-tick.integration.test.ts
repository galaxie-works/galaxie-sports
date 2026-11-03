import { randomBytes } from 'node:crypto';
import { closeDb, createDb, jobLockContender, runMigrations, syncCursor, type Database } from '@galaxie/db';
import postgres from 'postgres';
import { Registry } from 'prom-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LIVE_LEADER_SESSION_PREFIX,
  liveLeaders,
  liveTickRows,
  registerLiveTickMetrics,
  type LiveTickCursor,
} from '../src/index.js';

/**
 * Ritmo do ao vivo (#538) contra o Postgres: as linhas `state` e `tick` do ops.sync_cursor viram as métricas do
 * `/metrics` do scheduler, e a consulta das cópias que disputam a trava `live:leader` mostra quem lidera.
 */
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;

const NOW = new Date();
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();
const ahead = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();

const tick = (over: Partial<LiveTickCursor> = {}): LiveTickCursor => ({
  instance: 'ingestor-1',
  updatedAt: ago(8),
  lastTickAt: ago(8),
  lastIntervalSeconds: 17.3,
  recent: [
    { at: ago(200), seconds: 14.9 },
    { at: ago(8), seconds: 17.3 },
  ],
  plannedIntervalSeconds: 15,
  pausedUntil: null,
  ...over,
});

async function put(sport: string, key: 'state' | 'tick', cursor: unknown) {
  await db
    .insert(syncCursor)
    .values({ provider: 'api-sports', sport, endpoint: 'live:scheduler', key, cursor, updatedAt: NOW })
    .onConflictDoUpdate({
      target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
      set: { cursor, updatedAt: NOW },
    });
}

async function scrape() {
  const registry = new Registry();
  registerLiveTickMetrics(registry, db, { now: () => NOW, cacheMs: 0 });
  const json = (await registry.getMetricsAsJSON()) as unknown as {
    name: string;
    values: { labels: Record<string, string>; value: number }[];
  }[];
  return (name: string, labels: Record<string, string> = {}) =>
    json
      .find((m) => m.name === name)
      ?.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))?.value;
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 4 });
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end({ timeout: 5 });
});

describe('métricas do ritmo do ao vivo', () => {
  it('com jogo em andamento e o runner ticando: idade, intervalos, ritmo do plano e janela aberta', async () => {
    await put('football', 'state', { segments: [{ start: ago(900), end: ahead(3600), leagues: ['71'] }] });
    await put('football', 'tick', tick());
    const get = await scrape();
    expect(get('live_last_tick_age_seconds', { sport: 'football' })).toBeCloseTo(8, 0);
    expect(get('live_tick_interval_seconds', { sport: 'football' })).toBe(17.3);
    expect(get('live_tick_interval_max_seconds', { sport: 'football' })).toBe(17.3);
    expect(get('live_tick_planned_interval_seconds', { sport: 'football' })).toBe(15);
    expect(get('live_tick_paused', { sport: 'football' })).toBe(0);
    expect(get('live_window_open', { sport: 'football' })).toBe(1);
  });

  it('runner parado com a janela aberta: a idade cresce e a janela segue aberta (o que o LiveTickGap enxerga)', async () => {
    await put('football', 'tick', tick({ lastTickAt: ago(95), updatedAt: ago(95) }));
    const get = await scrape();
    expect(get('live_last_tick_age_seconds', { sport: 'football' })).toBeCloseTo(95, 0);
    expect(get('live_window_open', { sport: 'football' })).toBe(1);
    expect(get('live_tick_paused', { sport: 'football' })).toBe(0);
  });

  it('meio-tempo: a pausa de propósito aparece e a janela segue aberta', async () => {
    await put('football', 'tick', tick({ lastTickAt: ago(300), pausedUntil: ahead(300) }));
    const get = await scrape();
    expect(get('live_tick_paused', { sport: 'football' })).toBe(1);
    expect(get('live_window_open', { sport: 'football' })).toBe(1);
  });

  it('plano do dia sem janela aberta agora: janela fechada', async () => {
    await put('football', 'state', { segments: [{ start: ahead(3600), end: ahead(7200), leagues: ['71'] }] });
    const get = await scrape();
    expect(get('live_window_open', { sport: 'football' })).toBe(0);
  });

  it('lê o registro gravado pelo runner (JSON do banco) sem perder nenhum campo', async () => {
    const rows = await liveTickRows(db);
    const football = rows.find((r) => r.sport === 'football')!;
    expect(football.tick).toMatchObject({ instance: 'ingestor-1', plannedIntervalSeconds: 15 });
    expect(football.segments).toHaveLength(1);
  });
});

describe('quem lidera o ao vivo (live_leader{instance})', () => {
  it('a líder tem a trava live:leader; a reserva disputa e fica em 0; trocou, trocou a série', async () => {
    const url = (name: string) => ({ applicationName: `${LIVE_LEADER_SESSION_PREFIX}${name}` });
    const a = jobLockContender(testUrl, 'live:leader', url('ingestor-1'));
    const b = jobLockContender(testUrl, 'live:leader', url('ingestor-2'));
    try {
      expect(await liveLeaders(db)).toEqual([]);
      const held = await a.tryAcquire();
      expect(held).not.toBeNull();
      expect(await b.tryAcquire()).toBeNull();

      let get = await scrape();
      expect(get('live_leader', { instance: 'ingestor-1' })).toBe(1);
      expect(get('live_leader', { instance: 'ingestor-2' })).toBe(0);

      await held!.release();
      expect(await b.tryAcquire()).not.toBeNull();
      get = await scrape();
      expect(get('live_leader', { instance: 'ingestor-1' })).toBe(0);
      expect(get('live_leader', { instance: 'ingestor-2' })).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('sem ninguém disputando (LIVE_LEADER=off): sem série live_leader', async () => {
    const get = await scrape();
    expect(get('live_leader')).toBeUndefined();
  });
});
