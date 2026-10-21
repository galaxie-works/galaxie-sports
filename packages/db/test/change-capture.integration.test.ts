import { randomBytes } from 'node:crypto';
import { asc, eq, gt, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  broadcastOption,
  changeFeed,
  closeDb,
  competition,
  createDb,
  event,
  eventContext,
  eventIncident,
  publishChange,
  runMigrations,
  sport,
  type Database,
} from '../src/index.js';

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
let competitionId: string;
let eventId: string;
let oldEventId: string;
let mark = 0;

/** Mudanças publicadas desde o último `beforeEach`. */
const changes = () => db.select().from(changeFeed).where(gt(changeFeed.id, mark)).orderBy(asc(changeFeed.id));

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });

  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'serie-a', name: 'Serie A', type: 'league', tier: 1 })
    .returning();
  competitionId = comp!.id;
  const now = Date.now();
  const [live, old] = await db
    .insert(event)
    .values([
      {
        sport: 'football',
        competitionId,
        startsAt: new Date(now - 30 * 60_000),
        endsAtExpected: new Date(now + 85 * 60_000),
        status: 'live',
        score: { home: 0, away: 0 },
        clock: { minute: 30, extra: null, period: '1H' },
      },
      {
        sport: 'football',
        competitionId,
        startsAt: new Date('2024-05-01T22:00:00Z'),
        endsAtExpected: new Date('2024-05-02T00:00:00Z'),
        status: 'finished',
      },
    ])
    .returning();
  eventId = live!.id;
  oldEventId = old!.id;
}, 60_000);

beforeEach(async () => {
  const [row] = await db.select({ max: sql<string | null>`max(${changeFeed.id})` }).from(changeFeed);
  mark = Number(row?.max ?? 0);
});

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('triggers de captura → ops.change_feed', () => {
  it('core.event: placar e relógio viram score_changed e status_changed com os novos valores', async () => {
    await db
      .update(event)
      .set({ score: { home: 1, away: 0 }, clock: { minute: 31, extra: null, period: '1H' } })
      .where(eq(event.id, eventId));
    const rows = await changes();
    expect(rows.map((r) => r.topic).sort()).toEqual(['event.score_changed', 'event.status_changed']);
    const score = rows.find((r) => r.topic === 'event.score_changed')!;
    expect(score).toMatchObject({ entityType: 'event', entityId: eventId });
    expect(score.payload).toEqual({
      event_id: eventId,
      sport: 'football',
      competition_id: competitionId,
      changed: ['score'],
      data: { score: { home: 1, away: 0 } },
    });
    const status = rows.find((r) => r.topic === 'event.status_changed')!;
    expect(status.payload).toMatchObject({
      changed: ['clock'],
      data: { status: 'live', clock: { minute: 31 } },
      previous: { status: 'live' },
    });
  });

  it('core.event: update sem mudança de estado não publica nada', async () => {
    await db.update(event).set({ importance: 50 }).where(eq(event.id, eventId));
    await db
      .update(event)
      .set({ score: { home: 1, away: 0 } })
      .where(eq(event.id, eventId));
    expect(await changes()).toHaveLength(0);
  });

  it('deduplica na mesma transação: uma linha por (tópico, entidade), payloads fundidos', async () => {
    await db.transaction(async (tx) => {
      await tx.update(event).set({ status: 'break', statusDetail: 'HT' }).where(eq(event.id, eventId));
      await tx.update(event).set({ status: 'live', statusDetail: '2H' }).where(eq(event.id, eventId));
      // o app também publica a mesma mudança: não duplica
      await publishChange(tx, {
        topic: 'event.status_changed',
        entityType: 'event',
        entityId: eventId,
        payload: { tags: ['extra-tag'] },
      });
    });
    const rows = await changes();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      changed: ['status', 'status_detail'],
      data: { status: 'live', status_detail: '2H' },
      previous: { status: 'live' },
      tags: ['extra-tag'],
    });
  });

  it('core.event_incident: lances novos viram um incident_added acumulado; histórico é ignorado', async () => {
    await db.insert(eventIncident).values([
      { eventId, sequence: 0, minute: 12, type: 'goal', detail: 'Normal Goal' },
      { eventId, sequence: 1, minute: 20, type: 'card', detail: 'Yellow Card' },
      { eventId: oldEventId, sequence: 0, minute: 5, type: 'goal' },
    ]);
    const rows = await changes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topic: 'event.incident_added', entityId: eventId });
    const data = (rows[0]!.payload as { data: { incidents: { sequence: number; type: string }[] } }).data;
    expect(data.incidents.map((i) => [i.sequence, i.type])).toEqual([
      [0, 'goal'],
      [1, 'card'],
    ]);

    // upsert de um lance existente (caminho UPDATE do ON CONFLICT) não é "lance novo"
    mark = Number((await db.select({ max: sql<string>`max(id)` }).from(changeFeed))[0]!.max);
    await db
      .insert(eventIncident)
      .values({ eventId, sequence: 0, minute: 13, type: 'goal' })
      .onConflictDoUpdate({
        target: [eventIncident.eventId, eventIncident.sequence],
        set: { minute: 13 },
      });
    expect(await changes()).toHaveLength(0);
  });

  it('enrich.broadcast_option: inclusão, correção e remoção → where_to_watch.changed; reverificação não', async () => {
    const [opt] = await db
      .insert(broadcastOption)
      .values({
        eventId,
        countryCode: 'BR',
        providerName: 'Canal X',
        medium: 'free_tv',
        accessModel: 'free',
        status: 'confirmed',
        confidence: '0.95',
        evidence: [],
        producedBy: 'editorial:teste',
      })
      .returning();
    let rows = await changes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      topic: 'where_to_watch.changed',
      entityType: 'where_to_watch',
      entityId: eventId,
      payload: {
        event_id: eventId,
        changed: ['where_to_watch'],
        data: { countries: ['BR'] },
        tags: [`event:${eventId}`],
      },
    });

    mark = rows[0]!.id;
    await db
      .update(broadcastOption)
      .set({ lastVerifiedAt: new Date() })
      .where(eq(broadcastOption.id, opt!.id));
    expect(await changes()).toHaveLength(0);

    await db.update(broadcastOption).set({ status: 'retracted' }).where(eq(broadcastOption.id, opt!.id));
    await db.delete(broadcastOption).where(eq(broadcastOption.id, opt!.id));
    rows = await changes();
    expect(rows.map((r) => r.topic)).toEqual(['where_to_watch.changed', 'where_to_watch.changed']);
  });

  it('enrich.event_context: publicação → event.context_published; rejeitado não', async () => {
    await db.insert(eventContext).values([
      {
        eventId,
        locale: 'pt-BR',
        kind: 'preview',
        content: { text: 'x' },
        sources: [],
        model: 'teste',
      },
      {
        eventId,
        locale: 'es-AR',
        kind: 'preview',
        content: { text: 'y' },
        sources: [],
        model: 'teste',
        reviewStatus: 'rejected',
      },
    ]);
    const rows = await changes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      topic: 'event.context_published',
      entityType: 'event_context',
      entityId: eventId,
      payload: { data: { contexts: [{ locale: 'pt-BR', kind: 'preview', review_status: 'auto' }] } },
    });
  });

  it('publishChange de app continua funcionando fora de transação e notifica', async () => {
    const received: string[] = [];
    const sub = await db.$client.listen('ops_change_feed', (id) => received.push(id));
    const id = await publishChange(db, {
      topic: 'catalog',
      entityType: 'competition',
      entityId: competitionId,
    });
    await expect.poll(() => received).toContain(String(id));
    await sub.unlisten();
    const [row] = await db.select().from(changeFeed).where(eq(changeFeed.id, id));
    expect(row).toMatchObject({ topic: 'catalog', payload: null });
  });
});
