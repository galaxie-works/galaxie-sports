/**
 * Lendas da F1 (`/v1/sports/formula-1/legends`): quem entra e em que ordem, os números iguais aos da carreira, e a
 * temporada marcante com a equipe, a pintura da época, o número e o carro ao fundo (nunca CC BY-SA).
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  assetCredit,
  closeDb,
  competition,
  country,
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
  standing,
  type Database,
} from '@galaxie/db';
import type { LiveryEntry } from '@galaxie/knowledge';
import { loadRaceLegends } from '../src/teams/legends.js';

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
const ids: Record<string, string> = {};

const liveries: LiveryEntry[] = [
  {
    slug: 'mclaren',
    name: 'McLaren',
    review_status: 'approved',
    eras: [
      {
        from: 1981,
        to: 1996,
        colors: ['#e4002b', '#ffffff'],
        livery: 'Marlboro',
        sources: ['https://example.org/mcl'],
      },
    ],
  },
];

/** Foto do acervo com o crédito; `shareAlike` = CC BY-SA. */
async function photo(owner: string, role: string, year: number, file: string, shareAlike: boolean) {
  const [a] = await db
    .insert(asset)
    .values({
      kind: role === 'portrait' ? 'driver' : 'car',
      sourceUrl: `commons://File:${file}`,
      storageKey: `commons/f1/cars/${file}`,
      width: 1600,
      height: 1067,
      origin: 'commons',
      acervo: 'commons-f1',
    })
    .returning({ id: asset.id });
  await db.insert(assetCredit).values({
    assetId: a!.id,
    source: 'Wikimedia Commons',
    title: `File:${file}`,
    pageUrl: `https://commons.wikimedia.org/wiki/File:${file}`,
    author: 'Fotógrafo',
    license: shareAlike ? 'CC BY-SA 2.0' : 'CC BY 2.0',
    shareAlike,
  });
  await db
    .insert(participantPhoto)
    .values({ participantId: owner, assetId: a!.id, role, seasonYear: year, rank: 0, selectedBy: 'rules' });
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 2 });
  await db.insert(sport).values({ slug: 'formula-1', name: { 'pt-BR': 'Fórmula 1' } });
  await db.insert(country).values([
    { code: 'BR', name: { 'pt-BR': 'Brasil', 'es-AR': 'Brasil' } },
    { code: 'FR', name: { 'pt-BR': 'França', 'es-AR': 'Francia' } },
  ]);
  const [champ] = await db
    .insert(competition)
    .values({ sport: 'formula-1', slug: 'f1', name: 'Formula 1 World Championship', type: 'league' })
    .returning({ id: competition.id });
  const seasons = await db
    .insert(season)
    .values([1988, 1989].map((year) => ({ competitionId: champ!.id, year, label: String(year) })))
    .returning({ id: season.id, year: season.year });
  const seasonId = (y: number) => seasons.find((s) => s.year === y)!.id;
  const [senna, prost, rookie, mclaren] = await db
    .insert(participant)
    .values([
      { sport: 'formula-1', kind: 'driver', name: 'Ayrton Senna', shortName: 'Senna', countryCode: 'BR' },
      { sport: 'formula-1', kind: 'driver', name: 'Alain Prost', shortName: 'Prost', countryCode: 'FR' },
      { sport: 'formula-1', kind: 'driver', name: 'Piloto Estreante' },
      { sport: 'formula-1', kind: 'constructor', name: 'McLaren' },
    ])
    .returning({ id: participant.id });
  Object.assign(ids, { senna: senna!.id, prost: prost!.id, rookie: rookie!.id, mclaren: mclaren!.id });
  await db.insert(providerMap).values({
    entityType: 'participant',
    entityId: ids.mclaren!,
    provider: 'f1db',
    sport: 'formula-1',
    providerId: 'mclaren',
  });
  // Senna campeão de 1988; Prost campeão de nada (no teste)
  await db
    .insert(standing)
    .values({ seasonId: seasonId(1988), group: 'drivers', participantId: ids.senna!, rank: 1, points: 90 });

  const team = { id: 'mclaren', name: 'McLaren' };
  const races: { year: number; day: number; results: [string, number, Record<string, unknown>][] }[] = [
    {
      year: 1988,
      day: 1,
      results: [
        ['senna', 1, { number: 12, position_text: '1', team }],
        ['prost', 2, { number: 11, position_text: '2', team }],
      ],
    },
    {
      year: 1988,
      day: 2,
      // abandono ordenado (api-sports): não é vitória nem pódio
      results: [
        ['prost', 1, { number: 11, position_text: '1', team }],
        ['senna', 3, { number: 12, time: 'DNF', position_text: 'DNF', team }],
      ],
    },
    {
      year: 1989,
      day: 1,
      results: [
        ['senna', 1, { number: 1, position_text: '1', team }],
        ['prost', 2, { number: 2, position_text: '2', team }],
        ['rookie', 9, { number: 30, position_text: '9' }],
      ],
    },
  ];
  for (const [i, r] of races.entries()) {
    const startsAt = new Date(Date.UTC(r.year, 4, r.day));
    const [ev] = await db
      .insert(event)
      .values({
        sport: 'formula-1',
        competitionId: champ!.id,
        seasonId: seasonId(r.year),
        status: 'finished',
        startsAt,
        endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000),
      })
      .returning({ id: event.id });
    await db.insert(sportEventDetail).values({
      eventId: ev!.id,
      sport: 'formula-1',
      provider: 'f1db',
      providerEventId: `gp-${i}`,
      kind: 'race',
      summary: { type: 'Race' },
    });
    await db.insert(eventParticipant).values(
      r.results.map(([who, position, result]) => ({
        eventId: ev!.id,
        participantId: ids[who]!,
        side: 'grid' as const,
        position,
        result,
      })),
    );
  }
  // carros da McLaren: 1988 só em CC BY-SA (não vai ao fundo), 1989 em CC BY
  await photo(ids.mclaren!, 'car', 1988, 'MP4-4.jpg', true);
  await photo(ids.mclaren!, 'car', 1989, 'MP4-5.jpg', false);
  // carro de destaque do Prost (curadoria): o de 1988, CC BY
  await photo(ids.prost!, 'highlight_car', 1988, 'MP4-4 Prost.jpg', false);
  await photo(ids.senna!, 'portrait', 1988, 'Senna.jpg', true);
}, 120_000);

afterAll(async () => {
  await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('lendas da F1', () => {
  it('campeão primeiro, depois vitórias; os números contam como na carreira', async () => {
    const legends = await loadRaceLegends(db, 'pt-BR', 'https://assets.test', { liveries });
    expect(legends.map((l) => [l.name, l.titles, l.wins, l.races, l.podiums, l.criteria])).toEqual([
      ['Ayrton Senna', [1988], 2, 3, 2, ['titles', 'wins', 'races']],
      ['Alain Prost', [], 1, 3, 3, ['wins', 'races']],
      ['Piloto Estreante', [], 0, 1, 0, ['races']],
    ]);
    expect(legends[0]).toMatchObject({
      first_name: 'Ayrton',
      last_name: 'Senna',
      country: { code: 'BR', name: 'Brasil' },
      seasons: { from: 1988, to: 1989 },
      active: false,
      portrait: { role: 'portrait', credit: { share_alike: true } },
    });
  });

  it('sem destaque, o título vence, sem foto de fundo (a do carro da temporada não tem a nota do Gemini)', async () => {
    const [senna] = await loadRaceLegends(db, 'pt-BR', 'https://assets.test', { liveries });
    // 1988 (título): a foto do carro da temporada fica na galeria, mas o fundo é só o destaque do acervo
    expect(senna!.highlight).toMatchObject({
      season: 1988,
      team: {
        id: ids.mclaren,
        name: 'McLaren',
        constructor_name: 'McLaren',
        livery: { primary: '#e4002b', secondary: '#ffffff' },
      },
      car: null,
    });
  });

  it('o carro de destaque do acervo vence; sem equipe nem foto, o card fica com a cor e o número', async () => {
    const legends = await loadRaceLegends(db, 'pt-BR', 'https://assets.test', { liveries });
    expect(legends[1]!.highlight).toMatchObject({
      season: 1988,
      number: 11,
      car: { role: 'highlight_car', url: 'https://assets.test/commons/f1/cars/MP4-4 Prost.jpg' },
    });
    expect(legends[2]!.highlight).toEqual({ season: 1989, team: null, number: 30, car: null });
  });

  it('`limit` corta na ordem', async () => {
    const legends = await loadRaceLegends(db, 'pt-BR', undefined, { limit: 1 });
    expect(legends.map((l) => l.name)).toEqual(['Ayrton Senna']);
    // sem pintura curada, a equipe vem com `livery: null`
    expect(legends[0]!.highlight?.team?.livery).toBeNull();
    expect(legends[0]!.highlight?.team?.constructor_name).toBe('McLaren');
  });
});
