/**
 * Carreira na F1 (`/v1/teams/{id}/career`): título só de temporada encerrada. A liderança de uma temporada em
 * andamento (corrida ainda por vir) aparece como posição provisória (`final: false`) e não conta título.
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
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import type { LiveryEntry } from '@galaxie/knowledge';
import { RulesRegistry } from '../src/events/rules-registry.js';
import { loadRaceCareer, splitName } from '../src/teams/career.js';
import { loadTeamCompetitions } from '../src/teams/load-campaigns.js';

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
let driverId: string;
const THIS_YEAR = new Date().getUTCFullYear();

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
  const seasons = await db
    .insert(season)
    .values([
      { competitionId: champ!.id, year: 1988, label: '1988' },
      { competitionId: champ!.id, year: THIS_YEAR, label: String(THIS_YEAR) },
    ])
    .returning({ id: season.id, year: season.year });
  const [driver] = await db
    .insert(participant)
    .values({ sport: 'formula-1', kind: 'driver', name: 'Piloto Teste' })
    .returning({ id: participant.id });
  driverId = driver!.id;
  for (const s of seasons)
    await db
      .insert(standing)
      .values({ seasonId: s.id, group: 'drivers', participantId: driverId, rank: 1, points: 90 });
  // a temporada atual ainda tem corrida por vir
  const current = seasons.find((s) => s.year === THIS_YEAR)!;
  const startsAt = new Date(Date.now() + 7 * 86_400_000);
  const [race] = await db
    .insert(event)
    .values({
      sport: 'formula-1',
      competitionId: champ!.id,
      seasonId: current.id,
      startsAt,
      endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000),
    })
    .returning({ id: event.id });
  await db.insert(sportEventDetail).values({
    eventId: race!.id,
    sport: 'formula-1',
    provider: 'teste',
    providerEventId: 'race-1',
    kind: 'race',
    summary: { type: 'Race' },
  });
  // carro de destaque (acervo da Commons): McLaren 1988, com crédito
  const [car] = await db
    .insert(asset)
    .values({
      kind: 'car',
      sourceUrl: 'commons://File:MP4-4 Suzuka 1988.jpg',
      storageKey: 'commons/f1/cars/mclaren.abc.jpg',
      width: 1600,
      height: 1067,
      origin: 'commons',
      acervo: 'commons-f1',
    })
    .returning({ id: asset.id });
  await db.insert(assetCredit).values({
    assetId: car!.id,
    source: 'Wikimedia Commons',
    title: 'File:MP4-4 Suzuka 1988.jpg',
    pageUrl: 'https://commons.wikimedia.org/wiki/File:MP4-4_Suzuka_1988.jpg',
    author: 'Fotógrafo',
    license: 'CC BY-SA 2.0',
  });
  await db.insert(participantPhoto).values({
    participantId: driverId,
    assetId: car!.id,
    role: 'highlight_car',
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

describe('carreira na F1: carro de destaque', () => {
  it('o carro de destaque vem com a temporada e o crédito', async () => {
    const career = await loadRaceCareer(db, { id: driverId, kind: 'driver' }, 'pt-BR', 'https://assets.test');
    expect(career.highlight).toMatchObject({
      season: 1988,
      car: {
        url: 'https://assets.test/commons/f1/cars/mclaren.abc.jpg',
        role: 'highlight_car',
        credit: { author: 'Fotógrafo', license: 'CC BY-SA 2.0' },
      },
    });
  });
});

describe('carreira na F1: títulos', () => {
  it('liderança da temporada em andamento não é título', async () => {
    const career = await loadRaceCareer(db, { id: driverId, kind: 'driver' }, 'pt-BR', undefined);
    expect(career.titles).toEqual([1988]);
    expect(career.totals.titles).toBe(1);
    const byYear = new Map(career.seasons.map((s) => [s.year, s]));
    expect(byYear.get(1988)).toMatchObject({ position: 1, final: true });
    expect(byYear.get(THIS_YEAR)).toMatchObject({ position: 1, final: false });
  });
});

describe('carreira na F1: temporada atual, sprint, melhores resultados, número e pintura', () => {
  let rookie: string;
  const liveries: LiveryEntry[] = [
    {
      slug: 'mclaren',
      name: 'McLaren',
      review_status: 'approved',
      eras: [
        {
          from: 2018,
          to: null,
          colors: ['#ff8000', '#47c7fc'],
          livery: 'papaia',
          sources: ['https://example.org/mcl'],
        },
      ],
    },
  ];

  beforeAll(async () => {
    await db
      .insert(country)
      .values({ code: 'IT', name: { 'pt-BR': 'Itália' } })
      .onConflictDoNothing();
    const [champ] = await db
      .insert(competition)
      .values({ sport: 'formula-1', slug: 'f1-atual', name: 'Formula 1 World Championship', type: 'league' })
      .returning({ id: competition.id });
    // o calendário vai até dezembro: a liderança de agora não é título, mesmo sem GP futuro na base
    const [current] = await db
      .insert(season)
      .values({
        competitionId: champ!.id,
        year: THIS_YEAR,
        label: String(THIS_YEAR),
        endDate: `${THIS_YEAR + 1}-01-15`,
      })
      .returning({ id: season.id });
    const [driver, team] = await db
      .insert(participant)
      .values([
        {
          sport: 'formula-1',
          kind: 'driver',
          name: 'Kimi Antonelli',
          shortName: 'Antonelli',
          number: 12,
          birthDate: '2006-08-25',
          birthPlace: 'Bologna',
          birthCountryCode: 'IT',
        },
        { sport: 'formula-1', kind: 'constructor', name: 'McLaren' },
      ])
      .returning({ id: participant.id });
    rookie = driver!.id;
    await db.insert(providerMap).values({
      entityType: 'participant',
      entityId: team!.id,
      provider: 'f1db',
      sport: 'formula-1',
      providerId: 'mclaren',
    });
    await db
      .insert(standing)
      .values({ seasonId: current!.id, group: 'drivers', participantId: rookie, rank: 1, points: 33 });

    const team1 = { id: 'mclaren', name: 'McLaren' };
    // sessões já disputadas: duas corridas (vitória da pole e abandono), sprint e as classificações
    const sessions: {
      days: number;
      type: string;
      position: number | null;
      result: Record<string, unknown>;
    }[] = [
      { days: 20, type: 'Qualifying', position: 1, result: { number: 12, team: team1 } },
      {
        days: 19,
        type: 'Race',
        position: 1,
        result: { number: 12, grid: 1, points: 25, position_text: '1', team: team1 },
      },
      { days: 13, type: 'Sprint Qualifying', position: 1, result: { number: 12, team: team1 } },
      {
        days: 13,
        type: 'Sprint',
        position: 2,
        result: { number: 12, grid: 1, points: 7, position_text: '2', team: team1 },
      },
      { days: 12, type: 'Qualifying', position: 3, result: { number: 12, team: team1 } },
      {
        days: 12,
        type: 'Race',
        position: 18,
        result: { number: 12, grid: 3, time: 'DNF', position_text: 'DNF', team: team1 },
      },
    ];
    for (const [i, x] of sessions.entries()) {
      const startsAt = new Date(Date.now() - x.days * 86_400_000);
      const [ev] = await db
        .insert(event)
        .values({
          sport: 'formula-1',
          competitionId: champ!.id,
          seasonId: current!.id,
          status: 'finished',
          startsAt,
          endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000),
        })
        .returning({ id: event.id });
      await db.insert(sportEventDetail).values({
        eventId: ev!.id,
        sport: 'formula-1',
        provider: 'f1db',
        providerEventId: `atual-${i}`,
        kind: 'race',
        summary: { type: x.type },
      });
      await db.insert(eventParticipant).values({
        eventId: ev!.id,
        participantId: rookie,
        side: 'grid',
        position: x.position,
        result: x.result,
      });
    }
  });

  it('temporada atual com o bloco da sprint, e liderança de agora sem título', async () => {
    const career = await loadRaceCareer(db, { id: rookie, kind: 'driver' }, 'pt-BR', undefined, { liveries });
    expect(career.current_season).toBe(THIS_YEAR);
    expect(career.competition?.slug).toBe('f1-atual');
    expect(career.titles).toEqual([]);
    const s = career.seasons.find((x) => x.year === THIS_YEAR)!;
    expect(s).toMatchObject({
      position: 1,
      final: false,
      races: 2,
      wins: 1,
      podiums: 1,
      poles: 1,
      top10: 1,
      dnfs: 1,
      number: 12,
      sprint: { races: 1, points: 7, wins: 0, podiums: 1, poles: 1, top10: 1 },
    });
    // a pintura da McLaren daquela época, pelo id do F1DB
    expect(s.teams[0]).toMatchObject({
      name: 'McLaren',
      livery: { primary: '#ff8000', secondary: '#47c7fc', source: 'https://example.org/mcl' },
    });
  });

  it('carreira: melhor resultado e melhor largada com a contagem; perfil com nascimento', async () => {
    const career = await loadRaceCareer(db, { id: rookie, kind: 'driver' }, 'pt-BR', undefined, { liveries });
    expect(career.totals).toMatchObject({
      races: 2,
      dnfs: 1,
      top10: 1,
      best_finish: { position: 1, count: 1 },
      best_grid: { position: 1, count: 1 },
      sprint: { races: 1, points: 7 },
    });
    expect(career.profile).toEqual({
      first_name: 'Kimi',
      last_name: 'Antonelli',
      number: 12,
      birth_date: '2006-08-25',
      birth_place: 'Bologna',
      birth_country: { code: 'IT', name: 'Itália' },
    });
  });

  it('campanha do overview: o líder de uma temporada com GP por vir não é campeão nem "terminou em"', async () => {
    // só sessões já disputadas na base (o F1DB não cria GP futuro), mas o calendário vai até o ano que vem
    const competitions = await loadTeamCompetitions(
      {
        db,
        locale: 'pt-BR',
        tz: 'UTC',
        now: new Date(),
        assetsBaseUrl: undefined,
        customLogos: false,
        rules: new RulesRegistry(),
      },
      rookie,
    );
    const current = competitions.find((c) => c.season.year === THIS_YEAR)!;
    expect(current.campaign).toMatchObject({ status: 'league', ongoing: true, rank: 1 });
  });

  it('sem pintura curada, a equipe vem sem `livery`; lenda fora do grid não tem temporada atual', async () => {
    const career = await loadRaceCareer(db, { id: rookie, kind: 'driver' }, 'pt-BR', undefined);
    expect(career.seasons[0]!.teams[0]!.livery).toBeUndefined();
    const legend = await loadRaceCareer(db, { id: driverId, kind: 'driver' }, 'pt-BR', undefined);
    expect(legend.current_season).toBeNull();
    expect(legend.profile).toMatchObject({ first_name: 'Piloto', last_name: 'Teste', number: null });
  });
});

describe('carreira na F1: uma linha por GP, largada, classificação e pole (auditoria contra o F1DB)', () => {
  let pilot: string;
  let leader: string;

  beforeAll(async () => {
    const [champ] = await db
      .insert(competition)
      .values({
        sport: 'formula-1',
        slug: 'f1-auditoria',
        name: 'Formula 1 World Championship',
        type: 'league',
      })
      .returning({ id: competition.id });
    const [s2022] = await db
      .insert(season)
      .values({ competitionId: champ!.id, year: 2022, label: '2022', endDate: '2022-11-20' })
      .returning({ id: season.id });
    const [p, l] = await db
      .insert(participant)
      .values([
        { sport: 'formula-1', kind: 'driver', name: 'Piloto Auditado' },
        { sport: 'formula-1', kind: 'driver', name: 'Piloto Líder' },
      ])
      .returning({ id: participant.id });
    pilot = p!.id;
    leader = l!.id;
    const team = { id: 'equipe', name: 'Equipe' };
    let day = 0;
    const gp = async () => {
      const [st] = await db
        .insert(stage)
        .values({
          seasonId: s2022!.id,
          kind: 'race_weekend',
          providerLabel: `gp-${day}`,
          name: { en: `GP ${day}` },
        })
        .returning({ id: stage.id });
      return st!.id;
    };
    const session = async (
      stageId: string,
      provider: 'f1db' | 'api-sports',
      type: string,
      rows: { id: string; position: number | null; result: Record<string, unknown> }[],
    ) => {
      day += 1;
      const startsAt = new Date(Date.UTC(2022, 2, day, 15));
      const [ev] = await db
        .insert(event)
        .values({
          sport: 'formula-1',
          competitionId: champ!.id,
          seasonId: s2022!.id,
          stageId,
          status: 'finished',
          startsAt,
          endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000),
        })
        .returning({ id: event.id });
      await db.insert(sportEventDetail).values({
        eventId: ev!.id,
        sport: 'formula-1',
        provider,
        providerEventId: `auditoria-${day}`,
        kind: 'race',
        summary: { type },
      });
      for (const r of rows)
        await db.insert(eventParticipant).values({
          eventId: ev!.id,
          participantId: r.id,
          side: 'grid',
          position: r.position,
          result: r.result,
        });
    };
    const me = (position: number | null, result: Record<string, unknown>) => ({
      id: pilot,
      position,
      result: { team, number: 44, ...result },
    });

    // GP A: a mesma corrida e a mesma pole nas duas fontes, sem vínculo (a api-sports de 2022 chegou depois)
    const a = await gp();
    await session(a, 'f1db', 'Qualifying', [me(1, { number: 99 })]);
    await session(a, 'api-sports', '3rd Qualifying', [me(1, { number: 99 })]);
    await session(a, 'f1db', 'Race', [me(3, { position_text: '3', grid: 1, pole: true, laps: 57 })]);
    await session(a, 'api-sports', 'Race', [me(3, { grid: 1, laps: 57 })]);
    // GP B: fez a pole e não largou (Leclerc, Mônaco 2021): pole sim, GP não
    const b = await gp();
    await session(b, 'f1db', 'Race', [me(null, { position_text: 'DNS', pole: true })]);
    // GP C (api-sports): parou com 56 de 58 voltas, `time: "DNF"`, mas cumpriu os 90%: classificado em 17º
    const c = await gp();
    await session(c, 'api-sports', 'Race', [
      { id: leader, position: 1, result: { team, laps: 58, grid: 2 } },
      me(17, { time: 'DNF', laps: 56, grid: 5 }),
    ]);
    // GP D (api-sports): não largou: sem posição, sem tempo e 0 volta
    const d = await gp();
    await session(d, 'api-sports', 'Race', [me(null, { laps: 0, grid: 7 })]);
    // GP E (F1DB): 18º classificado com `time: "DNF"` (Hamilton, Abu Dhabi 2022) e largada punida: pole de outro
    const e = await gp();
    await session(e, 'f1db', 'Race', [
      me(18, { position_text: '18', time: 'DNF', grid: 1, pole: false, laps: 55 }),
    ]);
  });

  it('conta como o F1DB: uma corrida e uma pole por GP, só GP largado, classificado pelos 90%', async () => {
    const career = await loadRaceCareer(db, { id: pilot, kind: 'driver' }, 'pt-BR', undefined);
    const s = career.seasons.find((x) => x.year === 2022)!;
    expect(s).toMatchObject({ races: 3, podiums: 1, poles: 2, dnfs: 0, top10: 1, number: 44 });
    expect(career.totals).toMatchObject({
      races: 3,
      poles: 2,
      dnfs: 0,
      best_finish: { position: 3, count: 1 },
    });
  });
});

describe('nome em duas partes', () => {
  it('pelo sobrenome do fornecedor ou pela última palavra', () => {
    expect(splitName('Kimi Antonelli', 'Antonelli')).toEqual({ first: 'Kimi', last: 'Antonelli' });
    expect(splitName('Carlos Sainz Jr.', 'Sainz Jr.')).toEqual({ first: 'Carlos', last: 'Sainz Jr.' });
    // a api-sports escreve sem o ponto: o sobrenome do F1DB fecha o nome mesmo assim
    expect(splitName('Carlos Sainz Jr', 'Sainz Jr.')).toEqual({ first: 'Carlos', last: 'Sainz Jr.' });
    // mesma grafia: vale a do nome
    expect(splitName('Nyck de Vries', 'De Vries')).toEqual({ first: 'Nyck', last: 'de Vries' });
    expect(splitName('Guanyu Zhou', 'Zhou')).toEqual({ first: 'Guanyu', last: 'Zhou' });
    expect(splitName('Ayrton Senna', 'SEN')).toEqual({ first: 'Ayrton', last: 'Senna' });
    expect(splitName('Zhou', null)).toEqual({ first: '', last: 'Zhou' });
  });
});
