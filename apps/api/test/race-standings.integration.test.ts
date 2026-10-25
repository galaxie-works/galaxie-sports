/**
 * Classificação da F1 enriquecida (`enrichRaceStandings`): retrato do acervo com o crédito, equipe da temporada
 * com o nome daquela época e a pintura curada, pódios só de chegada numérica e o empate em pontos na ordem da
 * contagem regressiva. Dados genéricos: uma temporada de três corridas.
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Standings } from '@galaxie/contracts';
import {
  asset,
  assetCredit,
  closeDb,
  competition,
  createDb,
  event,
  eventParticipant,
  participant,
  participantPhoto,
  providerMap,
  runMigrations,
  season,
  sport,
  sportEventDetail,
  type Database,
} from '@galaxie/db';
import type { LiveryEntry } from '@galaxie/knowledge';
import { enrichRaceStandings } from '../src/events/race-standings.js';

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
let seasonId: string;
const ids = { a: '', b: '', c: '', red: '', yellow: '' };

const liveries: LiveryEntry[] = [
  {
    slug: 'equipe-vermelha',
    name: 'Equipe Vermelha',
    review_status: 'approved',
    eras: [
      {
        from: 1980,
        to: 1990,
        colors: ['#e4002b', '#ffffff'],
        livery: 'vermelho',
        sources: ['https://example.org/v'],
      },
    ],
  },
];

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 2 });
  await db.insert(sport).values({ slug: 'formula-1', name: { 'pt-BR': 'Fórmula 1' } });
  const [champ] = await db
    .insert(competition)
    .values({ sport: 'formula-1', slug: 'f1', name: 'Formula 1 World Championship', type: 'league' })
    .returning({ id: competition.id });
  const [s] = await db
    .insert(season)
    .values({ competitionId: champ!.id, year: 1988, label: '1988' })
    .returning({ id: season.id });
  seasonId = s!.id;
  const people = await db
    .insert(participant)
    .values([
      { sport: 'formula-1', kind: 'driver', name: 'Piloto A' },
      { sport: 'formula-1', kind: 'driver', name: 'Piloto B' },
      { sport: 'formula-1', kind: 'driver', name: 'Piloto C' },
      // o nome de hoje; o da época vem do resultado da corrida
      { sport: 'formula-1', kind: 'constructor', name: 'Equipe Vermelha Racing' },
      { sport: 'formula-1', kind: 'constructor', name: 'Equipe Amarela' },
    ])
    .returning({ id: participant.id });
  [ids.a, ids.b, ids.c, ids.red, ids.yellow] = people.map((p) => p.id) as [
    string,
    string,
    string,
    string,
    string,
  ];
  await db.insert(providerMap).values([
    {
      provider: 'f1db',
      sport: 'formula-1',
      entityType: 'participant',
      providerId: 'equipe-vermelha',
      entityId: ids.red,
    },
    {
      provider: 'f1db',
      sport: 'formula-1',
      entityType: 'participant',
      providerId: 'equipe-amarela',
      entityId: ids.yellow,
    },
  ]);

  const red = { id: 'equipe-vermelha', name: 'Vermelha' };
  const yellow = { id: 'equipe-amarela', name: 'Amarela' };
  // três GPs: A vence dois; B e C empatam em pontos (fora daqui), B com um 4º e C com um 5º
  const races: [string, number, typeof red, Record<string, unknown>?][][] = [
    [
      [ids.a, 1, red],
      [ids.b, 4, yellow],
      [ids.c, 5, yellow],
    ],
    [
      [ids.a, 1, red],
      [ids.c, 3, yellow, { position_text: 'DSQ' }],
      [ids.b, 6, yellow],
    ],
    [
      [ids.b, 2, yellow],
      [ids.a, 3, red, { time: 'DNF' }],
    ],
  ];
  for (const [i, grid] of races.entries()) {
    const startsAt = new Date(Date.UTC(1988, 3 + i, 3));
    const [e] = await db
      .insert(event)
      .values({
        sport: 'formula-1',
        competitionId: champ!.id,
        seasonId,
        startsAt,
        endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000),
        status: 'finished',
      })
      .returning({ id: event.id });
    await db.insert(sportEventDetail).values({
      eventId: e!.id,
      sport: 'formula-1',
      provider: 'teste',
      providerEventId: `race-${i}`,
      kind: 'race',
      summary: { type: 'Race' },
    });
    await db.insert(eventParticipant).values(
      grid.map(([participantId, position, team, extra]) => ({
        eventId: e!.id,
        participantId,
        side: 'grid' as const,
        position,
        result: { team, position_text: String(position), ...extra },
      })),
    );
  }

  const [portrait] = await db
    .insert(asset)
    .values({
      kind: 'driver',
      sourceUrl: 'commons://File:Piloto A.jpg',
      storageKey: 'commons/f1/drivers/a.jpg',
      width: 900,
      height: 1200,
      origin: 'commons',
    })
    .returning({ id: asset.id });
  await db.insert(assetCredit).values({
    assetId: portrait!.id,
    source: 'Wikimedia Commons',
    title: 'File:Piloto A.jpg',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:Piloto_A.jpg',
    author: 'Fotógrafo',
    license: 'CC BY 2.0',
  });
  await db.insert(participantPhoto).values({
    participantId: ids.a,
    assetId: portrait!.id,
    role: 'portrait',
    seasonYear: 1988,
    rank: 0,
    selectedBy: 'rules',
  });
}, 120_000);

afterAll(async () => {
  await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const row = (id: string, name: string, rank: number, points: number) => ({
  rank,
  participant: { id, name, short_name: null, logo: null },
  points,
  played: 3,
  won: 0,
  drawn: 0,
  lost: 0,
  ot_won: null,
  ot_lost: null,
  goals_for: 0,
  goals_against: 0,
  goal_diff: 0,
  form: null,
  description: null,
});

describe('classificação da F1 enriquecida', () => {
  it('retrato, equipe da época com a cor, pódios e o empate pela contagem regressiva', async () => {
    const groups: Standings['groups'] = [
      {
        name: 'drivers',
        display_name: null,
        table: null,
        table_key: null,
        current: null,
        source: 'provider' as const,
        // C antes de B, como poderia vir do banco: o empate é reordenado
        rows: [row(ids.a, 'Piloto A', 1, 18), row(ids.c, 'Piloto C', 2, 6), row(ids.b, 'Piloto B', 2, 6)],
      },
      {
        name: 'constructors',
        display_name: null,
        table: null,
        table_key: null,
        current: null,
        source: 'provider' as const,
        rows: [row(ids.red, 'Equipe Vermelha Racing', 1, 18), row(ids.yellow, 'Equipe Amarela', 2, 12)],
      },
    ];
    await enrichRaceStandings(db, seasonId, groups, {
      assetsBaseUrl: 'https://assets.test',
      liveries,
      year: 1988,
    });
    const [drivers, constructors] = groups;
    expect(drivers!.rows.map((r) => r.participant.name)).toEqual(['Piloto A', 'Piloto B', 'Piloto C']);
    expect(drivers!.rows[0]).toMatchObject({
      photo: {
        url: 'https://assets.test/commons/f1/drivers/a.jpg',
        role: 'portrait',
        credit: { author: 'Fotógrafo', license: 'CC BY 2.0' },
      },
      season_team: { id: ids.red, name: 'Vermelha', livery: { primary: '#e4002b' } },
      // o 3º da terceira corrida foi abandono: não é pódio
      podiums: 2,
    });
    expect(drivers!.rows[1]).toMatchObject({
      photo: null,
      season_team: { name: 'Amarela', livery: null },
      podiums: 1,
    });
    // o 3º desclassificado não conta
    expect(drivers!.rows[2]!.podiums).toBe(0);
    expect(constructors!.rows[0]!.season_team).toMatchObject({ id: ids.red, name: 'Vermelha' });
  });
});
