/**
 * Clássico e importância na gravação do evento (issue #39): o upsert da normalização consulta a base
 * semântica do banco, e `recomputeEventImportance` (CLI `events:importance`) corrige o que foi gravado
 * antes do seed. Base semântica real (`data/knowledge`), carregada por `seedSemantic`.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeFeed, derby, event, sport, type Database } from '@galaxie/db';
import { loadKnowledge, seedSemantic } from '@galaxie/knowledge';
import { importance, normalizeFixtures } from '@galaxie/providers';
import { recomputeEventImportance, IMPORTANCE_TOPIC } from '../src/normalize/importance.js';
import { upsertBatch } from '../src/normalize/upsert-core.js';
import { apiFixture, type WorldMatch } from '../src/testing/live-world.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;

const TEAM_IDS: Record<string, number> = { Palmeiras: 121, 'Sao Paulo': 126, 'Time Neutro': 99001 };
const teamId = (name: string) => TEAM_IDS[name] ?? 99999;
const SEEDED_AT = new Date('2026-10-21T10:00:00Z');

const match = (fixtureId: number, home: string, away: string, kickoff: string): WorldMatch => ({
  fixtureId,
  leagueId: 71,
  leagueName: 'Serie A',
  round: 'Regular Season - 31',
  home,
  away,
  kickoff: new Date(kickoff),
  goals: [],
  tier: 1,
  livePriority: 'high',
  stageKind: 'regular',
});

async function ingest(matches: WorldMatch[], at = SEEDED_AT) {
  return upsertBatch(
    db,
    normalizeFixtures(
      matches.map((m) => apiFixture(m, at, teamId)),
      at,
    ),
  );
}

async function eventOf(fixtureId: number) {
  const rows = await db.execute<{ id: string; derby_id: string | null; importance: number }>(
    sql`select e.id, e.derby_id, e.importance from core.event e
          join core.provider_map pm on pm.entity_type = 'event' and pm.entity_id = e.id
         where pm.provider_id = ${String(fixtureId)}`,
  );
  return rows[0]!;
}

// competição criada pela normalização: tier padrão 3 (o catálogo é dono do tier)
const base = importance({ tier: 3, stageKind: 'regular' }).score;
let choqueRei: { id: string; intensity: number };

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
}, 60_000);

afterAll(async () => {
  await disposable.teardown();
});

describe('clássico e importância (#39)', () => {
  it('sem base semântica: evento sem clássico, importância só de tier e fase', async () => {
    await ingest([match(7001, 'Palmeiras', 'Sao Paulo', '2026-10-25T19:00:00Z')]);
    expect(await eventOf(7001)).toMatchObject({ derby_id: null, importance: base });
  });

  it('seed semântico liga o clássico; events:importance recalcula a importância com a intensidade', async () => {
    const seeded = await seedSemantic(db, await loadKnowledge());
    expect(seeded.linked.teams).toBeGreaterThanOrEqual(2);
    const [row] = await db.select().from(derby).where(eq(derby.slug, 'choque-rei'));
    choqueRei = { id: row!.id, intensity: row!.intensity };
    // o seed preenche derby_id, mas a importância gravada ainda é a antiga
    expect(await eventOf(7001)).toMatchObject({ derby_id: choqueRei.id, importance: base });

    const plan = await recomputeEventImportance(db, { dryRun: true });
    expect(plan).toMatchObject({ examined: 1, importanceChanged: 1, derbies: 1, dryRun: true });
    expect((await eventOf(7001)).importance).toBe(base);

    const done = await recomputeEventImportance(db, { sport: 'football' });
    expect(done).toMatchObject({ examined: 1, importanceChanged: 1, derbies: 1, derbiesChanged: 0 });
    expect((await eventOf(7001)).importance).toBe(base + 6 * choqueRei.intensity);
    // purge do cache do evento pelo change feed (tópico interno)
    const feed = await db.select().from(changeFeed).where(eq(changeFeed.topic, IMPORTANCE_TOPIC));
    expect(feed).toHaveLength(1);
    expect((feed[0]!.payload as { tags: string[] }).tags).toEqual([`event:${(await eventOf(7001)).id}`]);

    // idempotente
    expect(await recomputeEventImportance(db)).toMatchObject({ importanceChanged: 0, derbiesChanged: 0 });
  });

  it('evento novo já sai com o clássico (em qualquer mando) e a importância com a intensidade', async () => {
    await ingest([
      match(7002, 'Sao Paulo', 'Palmeiras', '2026-11-08T19:00:00Z'),
      match(7003, 'Palmeiras', 'Time Neutro', '2026-11-15T19:00:00Z'),
    ]);
    expect(await eventOf(7002)).toMatchObject({
      derby_id: choqueRei.id,
      importance: base + 6 * choqueRei.intensity,
    });
    expect(await eventOf(7003)).toMatchObject({ derby_id: null, importance: base });
  });

  it('nova observação do provedor mantém o clássico; upsert sem busca preserva o já gravado', async () => {
    await ingest(
      [match(7002, 'Sao Paulo', 'Palmeiras', '2026-11-08T19:00:00Z')],
      new Date('2026-10-22T10:00:00Z'),
    );
    expect((await eventOf(7002)).derby_id).toBe(choqueRei.id);
    await upsertBatch(
      db,
      normalizeFixtures(
        [
          apiFixture(
            match(7002, 'Sao Paulo', 'Palmeiras', '2026-11-08T19:00:00Z'),
            new Date('2026-10-23T10:00:00Z'),
            teamId,
          ),
        ],
        new Date('2026-10-23T10:00:00Z'),
      ),
      { derbyLookup: false },
    );
    expect(await eventOf(7002)).toMatchObject({
      derby_id: choqueRei.id,
      importance: base + 6 * choqueRei.intensity,
    });
    const [e] = await db
      .select({ derbyId: event.derbyId })
      .from(event)
      .where(eq(event.id, (await eventOf(7002)).id));
    expect(e!.derbyId).toBe(choqueRei.id);
  });
});
