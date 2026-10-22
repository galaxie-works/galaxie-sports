/**
 * Importância revisada (docs/06 §3, 2026-10): perna do confronto (ida × 0,75, volta elimina), final vale
 * o título, prestígio do catálogo e sinais da tabela pelo motor de regras no recálculo periódico — que o
 * upsert da normalização preserva.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { competition, participant, season, sport, standing, type Database } from '@galaxie/db';
import { normalizeFixtures } from '@galaxie/providers';
import { syncCompetitionPrestige } from '../src/catalog/prestige.js';
import { recomputeEventImportance } from '../src/normalize/importance.js';
import { upsertBatch } from '../src/normalize/upsert-core.js';
import { apiFixture, type WorldMatch } from '../src/testing/live-world.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;

const TEAM_IDS: Record<string, number> = {
  Palmeiras: 121,
  Fluminense: 124,
  Flamengo: 127,
  'RB Bragantino': 794,
};
const teamId = (name: string) => TEAM_IDS[name] ?? 99999;
const NOW = new Date('2026-10-22T10:00:00Z');

const match = (
  fixtureId: number,
  leagueId: number,
  round: string,
  home: string,
  away: string,
  kickoff: string,
): WorldMatch => ({
  fixtureId,
  leagueId,
  leagueName: leagueId === 13 ? 'CONMEBOL Libertadores' : 'Serie A',
  round,
  home,
  away,
  kickoff: new Date(kickoff),
  goals: [],
  tier: 1,
  livePriority: 'high',
  stageKind: 'regular',
});

async function ingest(matches: WorldMatch[], at = NOW) {
  return upsertBatch(
    db,
    normalizeFixtures(
      matches.map((m) => apiFixture(m, at, teamId)),
      at,
    ),
    { derbyLookup: false },
  );
}

async function eventOf(fixtureId: number) {
  const rows = await db.execute<{
    id: string;
    importance: number;
    importance_breakdown: {
      phase: number;
      decisive: number;
      prestige: number;
      leg: number | null;
      flags: string[];
      stake_flags: string[];
    } | null;
  }>(
    sql`select e.id, e.importance, e.importance_breakdown from core.event e
          join core.provider_map pm on pm.entity_type = 'event' and pm.entity_id = e.id
         where pm.provider_id = ${String(fixtureId)}`,
  );
  return rows[0]!;
}

/** Dá à competição criada pela normalização o slug/tier do catálogo (o regulamento vem pelo slug). */
async function catalog(leagueId: number, slug: string, prestige: number) {
  await db.execute(sql`
    update core.competition c set slug = ${slug}, tier = 1
      from core.provider_map pm
     where pm.entity_type = 'competition' and pm.entity_id = c.id and pm.provider_id = ${String(leagueId)}`);
  await syncCompetitionPrestige(db, 'football', [{ slug, prestige }]);
}

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
}, 60_000);

afterAll(async () => {
  await disposable.teardown();
});

describe('mata-mata: ida, volta e final', () => {
  it('upsert grava a perna pelos dados do lote (as duas partidas chegam juntas)', async () => {
    await ingest([
      match(8001, 13, 'Semi-finals', 'Fluminense', 'Palmeiras', '2026-10-15T00:30:00Z'),
      match(8002, 13, 'Semi-finals', 'Palmeiras', 'Fluminense', '2026-10-22T00:30:00Z'),
      match(8003, 13, 'Final', 'Palmeiras', 'Flamengo', '2026-11-28T20:00:00Z'),
    ]);
    // competição ainda fora do catálogo (tier 3, sem prestígio nem regulamento): jogo único na final
    expect((await eventOf(8001)).importance_breakdown).toMatchObject({ leg: 1, flags: [] });
    expect((await eventOf(8002)).importance_breakdown).toMatchObject({ leg: 2, flags: ['elimination'] });
    expect((await eventOf(8003)).importance_breakdown).toMatchObject({ leg: null, flags: ['title'] });
  });

  it('com catálogo e regulamento da Libertadores: ida 67, volta 80, final 95', async () => {
    await catalog(13, 'conmebol-libertadores', 10);
    const plan = await recomputeEventImportance(db, { dryRun: true, now: NOW });
    expect(plan.importanceChanged).toBe(3);
    expect((await eventOf(8002)).importance).not.toBe(80);

    await recomputeEventImportance(db, { now: NOW });
    expect(await eventOf(8001)).toMatchObject({ importance: 40 + 17 + 10 });
    expect(await eventOf(8002)).toMatchObject({
      importance: 40 + 22 + 8 + 10,
      importance_breakdown: { leg: 2, prestige: 10, decisive: 8, flags: ['elimination'] },
    });
    expect(await eventOf(8003)).toMatchObject({
      importance: 40 + 30 + 15 + 10,
      importance_breakdown: { flags: ['title'] },
    });
    // idempotente
    expect(await recomputeEventImportance(db, { now: NOW })).toMatchObject({ importanceChanged: 0 });
  });

  it('nova observação da volta pelo upsert mantém o mesmo score (perna pelo banco)', async () => {
    await ingest(
      [match(8002, 13, 'Semi-finals', 'Palmeiras', 'Fluminense', '2026-10-22T00:30:00Z')],
      new Date('2026-10-22T11:00:00Z'),
    );
    expect((await eventOf(8002)).importance).toBe(80);
  });
});

describe('pontos corridos: sinais da tabela pelo recálculo', () => {
  const TABLE: [string, number][] = [
    ['Flamengo', 67],
    ['Palmeiras', 66],
    ['Atletico Paranaense', 53],
    ['Cruzeiro', 51],
    ['Fluminense', 51],
    ['Atletico-MG', 50],
    ['Bahia', 49],
    ['Santos', 45],
    ['Sao Paulo', 42],
    ['RB Bragantino', 41],
    ['Botafogo', 39],
    ['Coritiba', 39],
    ['Vitoria', 37],
    ['Mirassol', 36],
    ['Vasco DA Gama', 35],
    ['Corinthians', 33],
    ['Internacional', 32],
    ['Gremio', 31],
    ['Remo', 26],
    ['Chapecoense-sc', 18],
  ];

  it('Palmeiras x Bragantino (rodada 32): corte realista tira o rebaixamento; título + vaga → 69', async () => {
    await ingest([
      match(9001, 71, 'Regular Season - 32', 'Palmeiras', 'RB Bragantino', '2026-10-24T21:30:00Z'),
    ]);
    await catalog(71, 'brasileirao-serie-a', 0);
    const ids = new Map(
      (await db.execute<{ id: string; name: string }>(sql`select id, name from core.participant`)).map(
        (r) => [r.name, r.id],
      ),
    );
    for (const [name] of TABLE) {
      if (ids.has(name)) continue;
      const [p] = await db
        .insert(participant)
        .values({ sport: 'football', kind: 'club', name })
        .returning({ id: participant.id });
      ids.set(name, p!.id);
    }
    const [s] = await db
      .select({ id: season.id })
      .from(season)
      .innerJoin(competition, eq(competition.id, season.competitionId))
      .where(eq(competition.slug, 'brasileirao-serie-a'));
    await db.insert(standing).values(
      TABLE.map(([name, points], i) => ({
        seasonId: s!.id,
        group: 'Serie A',
        participantId: ids.get(name)!,
        rank: i + 1,
        points,
        played: 31,
      })),
    );

    // fora do horizonte: nada da tabela entra
    await recomputeEventImportance(db, { now: NOW, stakesHorizonDays: 0 });
    expect(await eventOf(9001)).toMatchObject({
      importance: 40 + 9,
      importance_breakdown: { stake_flags: [], flags: [] },
    });

    const done = await recomputeEventImportance(db, { now: NOW });
    expect(done.stakesComputed).toBe(1);
    expect(done.withStakeFlags).toBe(1);
    const e = await eventOf(9001);
    // Palmeiras a 1 ponto do líder (título) e pode garantir a pré-Libertadores na rodada (código concreto:
    // vaga); Bragantino a 9 pontos da zona de rebaixamento: o risco de queda não passa no corte realista
    expect(e.importance_breakdown!.stake_flags).toEqual(['title', 'qualification']);
    expect(e).toMatchObject({ importance: 40 + 9 + 20, importance_breakdown: { decisive: 20 } });
  });

  it('o upsert preserva os sinais da tabela; fora do horizonte o recálculo também', async () => {
    await ingest(
      [match(9001, 71, 'Regular Season - 32', 'Palmeiras', 'RB Bragantino', '2026-10-24T21:30:00Z')],
      new Date('2026-10-22T12:00:00Z'),
    );
    expect((await eventOf(9001)).importance).toBe(69);
    await recomputeEventImportance(db, { now: new Date('2026-12-01T00:00:00Z') });
    expect((await eventOf(9001)).importance).toBe(69);
  });
});
