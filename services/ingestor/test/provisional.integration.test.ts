/**
 * Jogos provisórios: a curadoria grava o evento antes do fornecedor (provisional:sync) e a normalização
 * assume esse evento quando o jogo oficial chega — mesmo `event.id`, com o `provider_map` do fornecedor.
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  competition,
  event,
  eventParticipant,
  providerMap,
  season,
  sport,
  stage,
  type Database,
} from '@galaxie/db';
import { normalizeFixtures, type ApiFixture } from '@galaxie/providers';
import { upsertCatalog } from '../src/catalog/persist.js';
import { upsertBatch } from '../src/normalize/upsert-core.js';
import { parseProvisionalFile, type ProvisionalFixture } from '../src/provisional/config.js';
import { syncProvisionalFixtures } from '../src/provisional/sync.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;

const TEAMS: Record<number, string> = {
  121: 'Palmeiras',
  124: 'Fluminense',
  127: 'Flamengo',
  450: 'Estudiantes L.P.',
};
const CENTENARIO = { id: 1624, name: 'Estadio Centenario', city: 'Montevideo' };
const NOW = new Date('2026-10-23T12:00:00Z');

function fixture(o: {
  id: number;
  round: string;
  home: number;
  away: number;
  kickoff: string;
  status?: 'NS' | 'TBD' | 'FT' | 'PEN';
  goals?: [number, number];
  winner?: 'home' | 'away';
  venue?: { id: number; name: string; city: string };
  season?: number;
}): ApiFixture {
  const done = o.status === 'FT' || o.status === 'PEN';
  const goals = done ? (o.goals ?? [0, 0]) : [null, null];
  const side = (s: 'home' | 'away') => ({
    id: o[s],
    name: TEAMS[o[s]]!,
    logo: null,
    winner: o.winner ? o.winner === s : null,
  });
  return {
    fixture: {
      id: o.id,
      referee: null,
      timezone: 'UTC',
      date: o.kickoff,
      timestamp: Date.parse(o.kickoff) / 1000,
      venue: o.venue ?? { id: null, name: null, city: null },
      status: { long: '', short: o.status ?? 'NS', elapsed: done ? 90 : null },
    },
    league: {
      id: 13,
      name: 'CONMEBOL Libertadores',
      country: 'World',
      logo: null,
      flag: null,
      season: o.season ?? 2026,
      round: o.round,
    },
    teams: { home: side('home'), away: side('away') },
    goals: { home: goals[0]!, away: goals[1]! },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: goals[0]!, away: goals[1]! },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

const ingest = (fixtures: ApiFixture[], at: Date) => upsertBatch(db, normalizeFixtures(fixtures, at));

const entry = (over: Record<string, unknown> = {}): ProvisionalFixture =>
  parseProvisionalFile({
    schema_version: 1,
    fixtures: [
      {
        key: 'football-conmebol-libertadores-2026-final',
        sport: 'football',
        competition: 'conmebol-libertadores',
        season: 2026,
        stage: 'Final',
        home: { team: 121, name: 'Palmeiras' },
        away: { team: 450, name: 'Estudiantes L.P.' },
        date: '2026-11-28',
        time: null,
        timezone: 'America/Montevideo',
        venue: CENTENARIO,
        announced_by: 'Conmebol',
        status: 'announced',
        sources: [
          { name: 'Conmebol', url: 'https://gol.conmebol.com/libertadores', checked_at: '2026-10-23' },
        ],
        ...over,
      },
    ],
  })[0]!;

async function eventRow(id: string) {
  const [row] = await db.select().from(event).where(eq(event.id, id));
  const parts = await db
    .select({ participantId: eventParticipant.participantId, side: eventParticipant.side })
    .from(eventParticipant)
    .where(eq(eventParticipant.eventId, id));
  const maps = await db
    .select({ provider: providerMap.provider, providerId: providerMap.providerId })
    .from(providerMap)
    .where(and(eq(providerMap.entityType, 'event'), eq(providerMap.entityId, id)));
  return { row: row!, parts, maps };
}

async function participantOf(apiId: number): Promise<string> {
  const [m] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.entityType, 'participant'),
        eq(providerMap.providerId, String(apiId)),
      ),
    );
  return m!.id;
}

const footballEvents = async () =>
  Number(
    (
      await db.execute<{ n: number }>(sql`select count(*)::int as n from core.event where sport = 'football'`)
    )[0]!.n,
  );

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  // semifinais encerradas (com o classificado marcado) e um jogo no Centenário, para o estádio existir
  const seen = new Date('2026-10-23T03:00:00Z');
  await ingest(
    [
      fixture({
        id: 1001,
        round: 'Semi-finals',
        home: 124,
        away: 121,
        kickoff: '2026-10-15T00:30:00Z',
        status: 'FT',
        goals: [1, 2],
        winner: 'away',
      }),
      fixture({
        id: 1002,
        round: 'Semi-finals',
        home: 121,
        away: 124,
        kickoff: '2026-10-22T00:30:00Z',
        status: 'PEN',
        goals: [0, 1],
        winner: 'home',
      }),
      fixture({
        id: 1003,
        round: 'Semi-finals',
        home: 450,
        away: 127,
        kickoff: '2026-10-16T00:30:00Z',
        status: 'FT',
        goals: [0, 0],
      }),
      fixture({
        id: 1004,
        round: 'Semi-finals',
        home: 127,
        away: 450,
        kickoff: '2026-10-23T00:30:00Z',
        status: 'NS',
      }),
      fixture({
        id: 1005,
        round: 'Quarter-finals',
        home: 127,
        away: 124,
        kickoff: '2026-09-20T00:30:00Z',
        status: 'FT',
        goals: [2, 0],
        winner: 'home',
        venue: CENTENARIO,
      }),
    ],
    seen,
  );
  // o catálogo é dono do slug, do tier e do fim da temporada (bootstrap:catalog); aqui, direto no core
  await db.update(season).set({ startDate: '2026-02-04', endDate: '2026-10-23' });
  await db
    .update(competition)
    .set({ slug: 'conmebol-libertadores', tier: 1, prestige: 10 })
    .where(eq(competition.sport, 'football'));
}, 60_000);

afterAll(async () => {
  await disposable.teardown();
});

describe('jogo provisório (curadoria → core)', () => {
  let finalId: string;

  it('cria o evento na fase certa, com participantes e estádio do core e sem provider_map', async () => {
    const [r] = await syncProvisionalFixtures(db, [entry()], { now: NOW });
    expect(r).toMatchObject({ outcome: 'created' });
    finalId = r!.eventId!;
    const { row, parts, maps } = await eventRow(finalId);
    expect(row).toMatchObject({
      isProvisional: true,
      status: 'scheduled',
      statusDetail: 'TBD',
      sourceProvider: 'galaxie-curated',
      lastValidAt: null,
      startsAt: new Date('2026-11-28T15:00:00Z'),
      provisional: {
        key: 'football-conmebol-libertadores-2026-final',
        announcedBy: 'Conmebol',
        timeConfirmed: false,
      },
    });
    expect(row.importance).toBeGreaterThan(60);
    expect(row.importanceBreakdown).toMatchObject({ prestige: 10 });
    expect(maps).toEqual([]);
    expect(parts).toEqual(
      expect.arrayContaining([
        { participantId: await participantOf(121), side: 'home' },
        { participantId: await participantOf(450), side: 'away' },
      ]),
    );
    const [st] = await db.select().from(stage).where(eq(stage.id, row.stageId!));
    expect(st).toMatchObject({ kind: 'final', providerLabel: 'Final' });
    expect(row.venueId).not.toBeNull();
    // a temporada (fim = último jogo que o fornecedor conhece) passa a cobrir o jogo anunciado
    const [sea] = await db.select().from(season).where(eq(season.id, row.seasonId!));
    expect(sea!.endDate).toBe('2026-11-28');
  });

  it('o catálogo do fornecedor não encolhe a temporada para antes do jogo anunciado', async () => {
    await upsertCatalog(db, 'football', {
      countries: [{ code: 'WORLD', name: { en: 'World' }, flagUrl: null }],
      competitions: [
        {
          providerId: '13',
          slug: 'conmebol-libertadores',
          name: 'CONMEBOL Libertadores',
          labels: null,
          countryCode: 'WORLD',
          type: 'cup',
          tier: 1,
          livePriority: 'high',
          prestige: 10,
          logoUrl: null,
          seasons: [
            {
              year: 2026,
              label: '2026',
              startDate: '2026-02-04',
              endDate: '2026-10-23',
              current: true,
              coverage: {},
            },
          ],
        },
      ],
    });
    const { row } = await eventRow(finalId);
    const [sea] = await db.select().from(season).where(eq(season.id, row.seasonId!));
    expect(sea).toMatchObject({ startDate: '2026-02-04', endDate: '2026-11-28' });
  });

  it('é idempotente e acompanha a curadoria (horário confirmado)', async () => {
    expect((await syncProvisionalFixtures(db, [entry()], { now: NOW }))[0]).toMatchObject({
      outcome: 'unchanged',
      eventId: finalId,
    });
    const plan = await syncProvisionalFixtures(db, [entry({ time: '17:00' })], { now: NOW, dryRun: true });
    expect(plan[0]).toMatchObject({ outcome: 'updated' });
    expect((await eventRow(finalId)).row.statusDetail).toBe('TBD');

    expect((await syncProvisionalFixtures(db, [entry({ time: '17:00' })], { now: NOW }))[0]).toMatchObject({
      outcome: 'updated',
      eventId: finalId,
    });
    expect((await eventRow(finalId)).row).toMatchObject({
      startsAt: new Date('2026-11-28T20:00:00Z'),
      statusDetail: 'NS',
      provisional: { timeConfirmed: true },
    });
  });

  it('"vencedor de" resolve o classificado; sem jogo encerrado, fica pendente', async () => {
    // visitante Palmeiras: se o classificado resolver para o Palmeiras, os dois lados coincidem
    const third = (side: Record<string, unknown>) =>
      entry({
        key: 'football-conmebol-libertadores-2026-teste',
        stage: 'Teste',
        home: side,
        away: { team: 121, name: 'Palmeiras' },
        venue: null,
      });
    const pending = await syncProvisionalFixtures(
      db,
      [third({ winner_of: { stage: 'Semi-finals', teams: [127, 450] } })],
      { now: NOW, dryRun: true },
    );
    expect(pending[0]).toMatchObject({ outcome: 'pending', detail: expect.stringMatching(/classificado/) });

    const resolved = await syncProvisionalFixtures(
      db,
      [third({ winner_of: { stage: 'Semi-finals', teams: [121, 124] } })],
      { now: NOW, dryRun: true },
    );
    expect(resolved[0]).toMatchObject({ outcome: 'pending', detail: expect.stringMatching(/mesmo time/) });
  });

  it('time fora do core deixa o jogo pendente, sem gravar nada', async () => {
    const before = await footballEvents();
    const [r] = await syncProvisionalFixtures(
      db,
      [entry({ key: 'football-conmebol-libertadores-2026-x', away: { team: 99999, name: 'Ninguém' } })],
      { now: NOW },
    );
    expect(r).toMatchObject({ outcome: 'pending', eventId: null });
    expect(await footballEvents()).toBe(before);
  });
});

describe('junção com o jogo oficial', () => {
  it('o fornecedor publica a final: o oficial assume o mesmo evento e ganha o provider_map', async () => {
    const { row: before } = await eventRow(
      (await syncProvisionalFixtures(db, [entry({ time: '17:00' })], { now: NOW }))[0]!.eventId!,
    );
    const count = await footballEvents();
    const stats = await ingest(
      [
        fixture({
          id: 1500001,
          round: 'Final',
          home: 121,
          away: 450,
          kickoff: '2026-11-28T20:00:00Z',
          venue: CENTENARIO,
        }),
      ],
      new Date('2026-11-01T10:00:00Z'),
    );
    expect(stats.events).toMatchObject({ inserted: 0, updated: 1, provisionalMerged: 1 });
    expect(await footballEvents()).toBe(count);
    const { row, maps } = await eventRow(before.id);
    expect(maps).toEqual([{ provider: 'api-sports', providerId: '1500001' }]);
    expect(row).toMatchObject({
      isProvisional: false,
      sourceProvider: 'api-sports',
      statusDetail: 'NS',
      stageId: before.stageId,
      provisional: {
        key: 'football-conmebol-libertadores-2026-final',
        mergedProvider: 'api-sports',
        mergedProviderEventId: '1500001',
        mergedAt: '2026-11-01T10:00:00.000Z',
      },
    });

    // a curadoria reconhece o jogo oficial e não mexe mais nele
    expect((await syncProvisionalFixtures(db, [entry({ time: '18:00' })], { now: NOW }))[0]).toMatchObject({
      outcome: 'official',
      eventId: before.id,
    });
    expect((await eventRow(before.id)).row.startsAt).toEqual(new Date('2026-11-28T20:00:00Z'));
  });

  it('mandante invertido e data um dia depois: junta, troca os lados e a data', async () => {
    const [r] = await syncProvisionalFixtures(
      db,
      [
        entry({
          key: 'football-conmebol-libertadores-2026-3rd',
          stage: '3rd Place Final',
          home: { team: 127, name: 'Flamengo' },
          away: { team: 124, name: 'Fluminense' },
          date: '2026-11-27',
        }),
      ],
      { now: NOW },
    );
    expect(r).toMatchObject({ outcome: 'created' });
    const stats = await ingest(
      [
        fixture({
          id: 1500002,
          round: '3rd Place Final',
          home: 124,
          away: 127,
          kickoff: '2026-11-28T15:00:00Z',
        }),
      ],
      new Date('2026-11-02T10:00:00Z'),
    );
    expect(stats.events.provisionalMerged).toBe(1);
    const { row, parts, maps } = await eventRow(r!.eventId!);
    expect(row).toMatchObject({ isProvisional: false, startsAt: new Date('2026-11-28T15:00:00Z') });
    expect(maps).toEqual([{ provider: 'api-sports', providerId: '1500002' }]);
    expect(parts).toEqual(
      expect.arrayContaining([
        { participantId: await participantOf(124), side: 'home' },
        { participantId: await participantOf(127), side: 'away' },
      ]),
    );
    expect(parts).toHaveLength(2);
  });

  it('a mais de 2 dias ou em outra temporada não junta: o provisório continua', async () => {
    const [r] = await syncProvisionalFixtures(
      db,
      [
        entry({
          key: 'football-conmebol-libertadores-2026-longe',
          stage: 'Teste longe',
          home: { team: 127, name: 'Flamengo' },
          away: { team: 450, name: 'Estudiantes L.P.' },
          date: '2026-12-10',
        }),
      ],
      { now: NOW },
    );
    const stats = await ingest(
      [
        fixture({ id: 1500003, round: 'Teste longe', home: 127, away: 450, kickoff: '2026-12-13T15:00:00Z' }),
        fixture({
          id: 1500004,
          round: 'Teste longe',
          home: 127,
          away: 450,
          kickoff: '2026-12-10T15:00:00Z',
          season: 2027,
        }),
      ],
      new Date('2026-11-03T10:00:00Z'),
    );
    expect(stats.events).toMatchObject({ inserted: 2, provisionalMerged: 0 });
    expect((await eventRow(r!.eventId!)).row.isProvisional).toBe(true);
  });

  it('jogo que o fornecedor já publicou não vira provisório (sem duplicar)', async () => {
    await ingest(
      [fixture({ id: 1500005, round: 'Teste antes', home: 121, away: 127, kickoff: '2026-12-20T20:00:00Z' })],
      new Date('2026-11-04T10:00:00Z'),
    );
    const before = await footballEvents();
    const [r] = await syncProvisionalFixtures(
      db,
      [
        entry({
          key: 'football-conmebol-libertadores-2026-antes',
          stage: 'Teste antes',
          away: { team: 127, name: 'Flamengo' },
          date: '2026-12-21',
        }),
      ],
      { now: NOW },
    );
    expect(r).toMatchObject({ outcome: 'official', detail: expect.stringMatching(/já publicou/) });
    expect(await footballEvents()).toBe(before);
  });

  it('cancelado na curadoria: o provisório vira cancelado', async () => {
    const key = 'football-conmebol-libertadores-2026-longe';
    const cancelled = entry({
      key,
      stage: 'Teste longe',
      home: { team: 127, name: 'Flamengo' },
      away: { team: 450, name: 'Estudiantes L.P.' },
      date: '2026-12-10',
      status: 'cancelled',
    });
    const [r] = await syncProvisionalFixtures(db, [cancelled], { now: NOW });
    expect(r).toMatchObject({ outcome: 'cancelled' });
    expect((await eventRow(r!.eventId!)).row).toMatchObject({ status: 'cancelled', isProvisional: true });
    expect((await syncProvisionalFixtures(db, [cancelled], { now: NOW }))[0]!.outcome).toBe('unchanged');
  });
});
