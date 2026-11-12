/**
 * Gol anulado no Postgres: o gol sai da timeline, nada aparece, e o `poll` seguinte confirma (retracted-goals.ts). O
 * que fica pendente mora em `core.event.goal_watch`: não vira lance, não vai para o change feed, não toca em
 * `updated_at`.
 */
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeFeed,
  event,
  eventIncident,
  footballFixture,
  providerMap,
  sport,
  type Database,
} from '@galaxie/db';
import { normalizeFixtures, type ApiFixture, type ApiFixtureEvent } from '@galaxie/providers';
import { upsertBatch } from '@galaxie/core-writer';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;

// recente: o trigger de lance novo ignora jogo que começou há mais de 2 dias
const KICK = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 2 * 3_600_000);
const HOME = { id: 7001, name: 'São Paulo', logo: null, winner: null };
const AWAY = { id: 7002, name: 'Corinthians', logo: null, winner: null };

const goalEvent = (minute: number, team = AWAY, player = 9001): ApiFixtureEvent => ({
  time: { elapsed: minute, extra: null },
  team: { id: team.id, name: team.name },
  player: { id: player, name: `Jogador ${player}` },
  assist: { id: null, name: null },
  type: 'Goal',
  detail: 'Normal Goal',
  comments: null,
});
const cardEvent = (minute: number): ApiFixtureEvent => ({
  time: { elapsed: minute, extra: null },
  team: { id: HOME.id, name: HOME.name },
  player: { id: 9100, name: 'Jogador 9100' },
  assist: { id: null, name: null },
  type: 'Card',
  detail: 'Yellow Card',
  comments: null,
});

function fixture(
  id: number,
  o: {
    score: [number, number];
    minute: number;
    short?: string;
    events?: ApiFixtureEvent[] | null;
  },
): ApiFixture {
  const f: ApiFixture = {
    fixture: {
      id,
      referee: null,
      timezone: 'UTC',
      date: KICK.toISOString(),
      timestamp: Math.floor(KICK.getTime() / 1000),
      periods: { first: Math.floor(KICK.getTime() / 1000), second: null },
      venue: { id: null, name: null, city: null },
      status: { long: 'x', short: o.short ?? '2H', elapsed: o.minute, extra: null },
    },
    league: {
      id: 71,
      name: 'Serie A',
      country: 'Brazil',
      logo: null,
      flag: null,
      season: 2026,
      round: 'Regular Season - 1',
    },
    teams: { home: HOME, away: AWAY },
    goals: { home: o.score[0], away: o.score[1] },
    score: {
      halftime: { home: 0, away: 0 },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
  if (o.events !== null) f.events = o.events ?? [];
  return f;
}

/** Instantes em segundos a partir de 23:00 (2º tempo do jogo). */
const at = (seconds: number) => new Date(KICK.getTime() + 3_600_000 + seconds * 1000);

const poll = (id: number, seconds: number, o: Parameters<typeof fixture>[1]) =>
  upsertBatch(db, normalizeFixtures([fixture(id, o)], at(seconds)));

async function eventIdOf(fixtureId: number): Promise<string> {
  const [row] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(and(eq(providerMap.entityType, 'event'), eq(providerMap.providerId, String(fixtureId))));
  return row!.id;
}

async function timeline(eventId: string) {
  return db
    .select({
      sequence: eventIncident.sequence,
      type: eventIncident.type,
      detail: eventIncident.detail,
      minute: eventIncident.minute,
    })
    .from(eventIncident)
    .where(eq(eventIncident.eventId, eventId))
    .orderBy(asc(eventIncident.sequence));
}

async function eventRow(eventId: string) {
  const [row] = await db.select().from(event).where(eq(event.id, eventId));
  return row!;
}

async function feedSince(id: bigint | number, eventId: string) {
  return db
    .select({ topic: changeFeed.topic, payload: changeFeed.payload })
    .from(changeFeed)
    .where(and(eq(changeFeed.entityId, eventId), gte(changeFeed.id, Number(id) + 1)))
    .orderBy(asc(changeFeed.id));
}

async function lastFeedId(eventId: string): Promise<number> {
  const rows = await db
    .select({ id: changeFeed.id })
    .from(changeFeed)
    .where(eq(changeFeed.entityId, eventId));
  return Math.max(0, ...rows.map((r) => Number(r.id)));
}

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
});

afterAll(async () => {
  await disposable.teardown();
});

describe('gol anulado no upsert', () => {
  it('o gol sai, nada é exposto antes de confirmar, e o poll seguinte vira lance', async () => {
    await poll(8001, 0, { score: [0, 1], minute: 62, events: [cardEvent(10), goalEvent(62)] });
    const id = await eventIdOf(8001);
    expect((await eventRow(id)).goalWatch).toMatchObject({ peak: { home: 0, away: 1 }, pending: [] });
    const feed = await lastFeedId(id);

    await poll(8001, 15, { score: [0, 0], minute: 63, events: [cardEvent(10)] });
    expect(await timeline(id)).toEqual([expect.objectContaining({ type: 'card', minute: 10 })]);
    const pending = (await eventRow(id)).goalWatch!;
    expect(pending.pending).toHaveLength(1);
    expect(pending.pending[0]).toMatchObject({ goal: { minute: 62, type: 'goal' } });
    let published = await feedSince(feed, id);
    expect(published.filter((f) => f.topic === 'event.incident_added')).toEqual([]);
    expect(JSON.stringify(published)).not.toMatch(/goal_?watch|pending|peak/i);

    // antes dos 45 s, continua sem lance
    await poll(8001, 45, { score: [0, 0], minute: 63, events: [cardEvent(10)] });
    expect(await timeline(id)).toHaveLength(1);

    await poll(8001, 60, { score: [0, 0], minute: 64, events: [cardEvent(10)] });
    expect(await timeline(id)).toEqual([
      expect.objectContaining({ type: 'card', minute: 10 }),
      { sequence: 100_000, type: 'var', detail: 'Goal cancelled', minute: 62 },
    ]);
    expect((await eventRow(id)).goalWatch).toMatchObject({ pending: [], peak: { home: 0, away: 0 } });
    published = await feedSince(feed, id);
    expect(published.filter((f) => f.topic === 'event.incident_added')).toHaveLength(1);
    expect(JSON.stringify(published)).toContain('"sequence":100000');
    expect(JSON.stringify(published)).not.toMatch(/goal_?watch|pending|peak/i);

    // sobrevive às trocas seguintes
    await poll(8001, 75, { score: [0, 0], minute: 65, events: [cardEvent(10), cardEvent(65)] });
    expect((await timeline(id)).map((i) => i.sequence)).toEqual([0, 1, 100_000]);
    // o gol volta: o lance sai
    await poll(8001, 90, { score: [0, 1], minute: 65, events: [cardEvent(10), goalEvent(63, AWAY, 9002)] });
    expect((await timeline(id)).map((i) => i.type)).toEqual(['card', 'goal']);
  });

  it('lista vazia com o placar dizendo que há gols não apaga a timeline, nem no espelho', async () => {
    const list = [goalEvent(5), goalEvent(10), goalEvent(40, HOME, 9003), cardEvent(41)];
    await poll(8002, 0, { score: [1, 2], minute: 50, events: list });
    const id = await eventIdOf(8002);
    const before = await timeline(id);
    expect(before).toHaveLength(4);

    await poll(8002, 15, { score: [1, 2], minute: 50, events: [] });
    expect(await timeline(id)).toEqual(before);
    const [mirror] = await db
      .select({ detail: footballFixture.detail })
      .from(footballFixture)
      .where(eq(footballFixture.eventId, id));
    expect((mirror!.detail as { events: unknown[] }).events).toHaveLength(4);
    expect((await eventRow(id)).goalWatch).toMatchObject({ pending: [] });

    await poll(8002, 45, { score: [1, 2], minute: 51, events: list });
    expect(await timeline(id)).toEqual(before);
    expect((await eventRow(id)).goalWatch).toMatchObject({ pending: [] });
  });

  it('lista vazia com o placar caindo a zero é retirada: 1-0 sem outros lances', async () => {
    await poll(8003, 0, { score: [1, 0], minute: 30, events: [goalEvent(30, HOME, 9004)] });
    const id = await eventIdOf(8003);
    await poll(8003, 15, { score: [0, 0], minute: 31, events: [] });
    expect(await timeline(id)).toEqual([]);
    await poll(8003, 60, { score: [0, 0], minute: 31, events: [] });
    expect(await timeline(id)).toEqual([
      { sequence: 100_000, type: 'var', detail: 'Goal cancelled', minute: 30 },
    ]);
  });

  it('resposta sem `events` confirma o lance e a timeline fica como está', async () => {
    await poll(8004, 0, { score: [0, 1], minute: 62, events: [cardEvent(10), goalEvent(62)] });
    const id = await eventIdOf(8004);
    await poll(8004, 15, { score: [0, 1], minute: 63, events: [cardEvent(10)] });
    await poll(8004, 70, { score: [0, 0], minute: 64, events: null });
    expect((await timeline(id)).map((i) => [i.sequence, i.type])).toEqual([
      [0, 'card'],
      [100_000, 'var'],
    ]);
  });

  it('resposta final confirma na hora, sem esperar outro poll', async () => {
    await poll(8005, 0, { score: [0, 1], minute: 88, events: [goalEvent(88)] });
    const id = await eventIdOf(8005);
    await poll(8005, 15, { score: [0, 0], minute: 90, short: 'FT', events: [cardEvent(10)] });
    expect((await timeline(id)).map((i) => i.type)).toEqual(['card', 'var']);
    expect((await eventRow(id)).status).toBe('finished');
  });

  it('resposta com o relógio recuado não muda a memória nem a timeline', async () => {
    await poll(8006, 0, { score: [0, 1], minute: 64, events: [goalEvent(62)] });
    const id = await eventIdOf(8006);
    const watch = (await eventRow(id)).goalWatch;
    await poll(8006, 15, { score: [0, 0], minute: 63, events: [cardEvent(10)] });
    expect((await timeline(id)).map((i) => i.type)).toEqual(['goal']);
    expect((await eventRow(id)).goalWatch).toEqual(watch);
  });

  it('gravar só a memória não toca em `updated_at` nem publica nada', async () => {
    await poll(8007, 0, { score: [0, 1], minute: 62, events: [goalEvent(62)] });
    const id = await eventIdOf(8007);
    // a agenda do dia (sem `events`) deixa a observação de 15 s para trás no estado, não no detalhe
    await poll(8007, 30, { score: [0, 1], minute: 62, events: null });
    const before = await eventRow(id);
    const feed = await lastFeedId(id);
    await poll(8007, 15, { score: [0, 0], minute: 62, events: [cardEvent(10)] });
    const after = await eventRow(id);
    expect(after.goalWatch?.pending).toHaveLength(1);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.score).toEqual(before.score);
    const published = await feedSince(feed, id);
    expect(published.map((f) => f.topic)).not.toContain('event.status_changed');
    expect(published.map((f) => f.topic)).not.toContain('event.score_changed');
  });

  it('lance gravado pelo PR 643, sem memória, continua valendo', async () => {
    await poll(8008, 0, { score: [0, 0], minute: 62, events: [cardEvent(10)] });
    const id = await eventIdOf(8008);
    await db.insert(eventIncident).values({
      eventId: id,
      sequence: 100_000,
      minute: 40,
      type: 'var',
      detail: 'Goal cancelled',
      data: { type: 'Var', galaxie: { inferred: 'goal_retracted', goal: { type: 'goal', detail: null } } },
    });
    await poll(8008, 15, { score: [0, 0], minute: 63, events: [cardEvent(10), cardEvent(63)] });
    expect((await timeline(id)).map((i) => i.sequence)).toEqual([0, 1, 100_000]);
    const rows = await db
      .select({ id: eventIncident.id })
      .from(eventIncident)
      .where(and(eq(eventIncident.eventId, id), inArray(eventIncident.sequence, [100_000])));
    expect(rows).toHaveLength(1);
  });
});

describe('sinal de gol anulado no SSE e nos webhooks (#640)', () => {
  const varEvent = (minute: number, detail: string, team = AWAY, player = 9001): ApiFixtureEvent => ({
    time: { elapsed: minute, extra: null },
    team: { id: team.id, name: team.name },
    player: { id: player, name: `Jogador ${player}` },
    assist: { id: null, name: null },
    type: 'Var',
    detail,
    comments: null,
  });
  type Payload = { data?: Record<string, unknown>; previous?: Record<string, unknown> };
  const ofTopic = (rows: { topic: string; payload: unknown }[], topic: string) =>
    rows.filter((r) => r.topic === topic).map((r) => r.payload as Payload);

  it('São Paulo x Corinthians: a fonte apaga o gol sem VAR; a confirmação traz placar e lance com goal_cancelled', async () => {
    await poll(8101, 0, { score: [0, 1], minute: 62, events: [goalEvent(62)] });
    const id = await eventIdOf(8101);
    const feed = await lastFeedId(id);
    await poll(8101, 15, { score: [0, 0], minute: 63, events: [] });
    await poll(8101, 60, { score: [0, 0], minute: 64, events: [] });
    const published = await feedSince(feed, id);
    const [score] = ofTopic(published, 'event.score_changed');
    expect(score).toMatchObject({
      data: { score: { home: 0, away: 0 }, goal_cancelled: true },
      previous: { score: { home: 0, away: 1 } },
    });
    expect(ofTopic(published, 'event.incident_added')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          goal_cancelled: true,
          incidents: [expect.objectContaining({ type: 'var', detail: 'Goal cancelled' })],
        }),
      }),
    ]);
  });

  it('VAR do fornecedor com o gol na lista: o lance e a queda do placar levam o sinal', async () => {
    await poll(8102, 0, { score: [0, 1], minute: 62, events: [goalEvent(62)] });
    const id = await eventIdOf(8102);
    const feed = await lastFeedId(id);
    await poll(8102, 15, {
      score: [0, 0],
      minute: 64,
      events: [goalEvent(62), varEvent(64, 'Goal Disallowed - offside')],
    });
    const published = await feedSince(feed, id);
    expect(ofTopic(published, 'event.score_changed')[0]?.data).toMatchObject({ goal_cancelled: true });
    expect(ofTopic(published, 'event.incident_added')[0]?.data).toMatchObject({ goal_cancelled: true });
  });

  it('gol novo e VAR que confirma o gol não levam o sinal', async () => {
    await poll(8103, 0, { score: [0, 0], minute: 60, events: [] });
    const id = await eventIdOf(8103);
    const feed = await lastFeedId(id);
    await poll(8103, 15, {
      score: [0, 1],
      minute: 62,
      events: [goalEvent(62), varEvent(62, 'Goal confirmed')],
    });
    const published = await feedSince(feed, id);
    expect(ofTopic(published, 'event.score_changed')[0]).toMatchObject({
      data: { score: { home: 0, away: 1 } },
      previous: { score: { home: 0, away: 0 } },
    });
    expect(JSON.stringify(published)).not.toContain('goal_cancelled');
  });
});
