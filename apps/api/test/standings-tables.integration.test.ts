import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Standings, TeamOverview } from '@galaxie/contracts';
import {
  closeDb,
  competition,
  createDb,
  event,
  eventParticipant,
  participant,
  runMigrations,
  season,
  sport,
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import { computeStandings, type MatchResult } from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { RecordingCdnPurger } from '../src/cache/purger.js';
import { buildServer } from '../src/server.js';

/*
 * Tabelas da temporada pelo regulamento (config/rules, `tables:`): na Argentina 2026, as zonas do Apertura e
 * do Clausura (nomes de grupo vistos na API), a tabela anual e os promedios no mesmo `/standings`, com papel,
 * nome no idioma pedido e a fase em andamento; o overview do time mostra a posição na fase em andamento.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-test-${randomBytes(4).toString('hex')}:`;

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
const ids: Record<string, string> = {};

const get = async <T>(url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<T>();
};

async function seed() {
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [arg] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'argentina-liga-profesional',
      name: 'Liga Profesional Argentina',
      type: 'league',
    })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: arg!.id, label: '2026', year: 2026, current: true })
    .returning();
  const teams = await db
    .insert(participant)
    .values(
      ['Boca Juniors', 'River Plate', 'Racing Club', 'Independiente'].map((name) => ({
        sport: 'football',
        kind: 'club' as const,
        name,
      })),
    )
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  const row = (group: string, team: string, rank: number, played: number, source = 'provider') => ({
    seasonId: s!.id,
    group,
    participantId: ids[team]!,
    rank,
    points: played * 2,
    played,
    source,
  });
  await db.insert(standing).values([
    row('Apertura - Group A', 'Boca Juniors', 1, 16),
    row('Apertura - Group A', 'Racing Club', 2, 16),
    row('Apertura - Group B', 'River Plate', 1, 16),
    row('Apertura - Group B', 'Independiente', 2, 16),
    row('Clausura - Group A', 'Boca Juniors', 2, 9, 'computed'),
    row('Clausura - Group A', 'Racing Club', 1, 9, 'computed'),
    row('Clausura - Group B', 'River Plate', 1, 9, 'computed'),
    row('Clausura - Group B', 'Independiente', 2, 9, 'computed'),
    row('Tabla Anual', 'Boca Juniors', 1, 25, 'computed'),
    row('Tabla Anual', 'River Plate', 2, 25, 'computed'),
    row('Tabla Anual', 'Racing Club', 3, 25, 'computed'),
    row('Tabla Anual', 'Independiente', 4, 25, 'computed'),
    row('Promedios', 'River Plate', 1, 78),
    row('Promedios', 'Boca Juniors', 2, 78),
    // grupo que o regulamento não reconhece: exposto como veio, sem papel
    row('', 'Boca Juniors', 1, 30),
  ]);
  await seedLiguilla();
  await seedArgentinaPhases(arg!.id);
  await seedLigaMxClausura();
  await seedLibertadoresAdopted();
}

/**
 * Libertadores 2026, grupos A e B do fornecedor: um jogo do grupo A com rodada que o regulamento não reconhece
 * ("Group Stage - 2 (remarcado)"), adotado pelo recálculo, e a tabela calculada com ele.
 */
async function seedLibertadoresAdopted() {
  const [lib] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'conmebol-libertadores', name: 'Libertadores', type: 'cup' })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: lib!.id, label: '2026', year: 2026, current: true })
    .returning();
  const groupOf: Record<string, string> = {};
  for (const n of ['L-P1', 'L-P2', 'L-P3', 'L-P4']) groupOf[n] = 'Group A';
  for (const n of ['L-Q1', 'L-Q2', 'L-Q3', 'L-Q4']) groupOf[n] = 'Group B';
  const teams = await db
    .insert(participant)
    .values(Object.keys(groupOf).map((name) => ({ sport: 'football', kind: 'club' as const, name })))
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  const games: [string, string, string, number, number][] = [
    ['Group Stage - 1', 'L-P1', 'L-P2', 1, 0],
    // sem empate em todos os critérios (a ordem de quem empata em tudo é sorteio)
    ['Group Stage - 1', 'L-P3', 'L-P4', 2, 0],
    ['Group Stage - 1', 'L-Q1', 'L-Q2', 2, 1],
    ['Group Stage - 1', 'L-Q3', 'L-Q4', 1, 1],
    ['Group Stage - 2 (remarcado)', 'L-P1', 'L-P3', 2, 1],
    ['Group Stage - 2', 'L-P2', 'L-P4', 1, 1],
  ];
  const base = Date.UTC(2026, 3, 1, 22);
  const stages = new Map<string, string>();
  const results: MatchResult[] = [];
  for (const [i, [label, home, away, hg, ag]] of games.entries()) {
    let stageId = stages.get(label);
    if (!stageId) {
      const [st] = await db
        .insert(stage)
        .values({ seasonId: s!.id, kind: 'group', name: { 'pt-BR': label }, providerLabel: label })
        .returning();
      stageId = st!.id;
      stages.set(label, stageId);
    }
    const at = new Date(base + i * 86_400_000);
    const [e] = await db
      .insert(event)
      .values({
        sport: 'football',
        competitionId: lib!.id,
        seasonId: s!.id,
        stageId,
        startsAt: at,
        endsAtExpected: new Date(at.getTime() + 7_200_000),
        status: 'finished',
        score: { home: hg, away: ag },
      })
      .returning();
    await db.insert(eventParticipant).values([
      { eventId: e!.id, participantId: ids[home]!, side: 'home' },
      { eventId: e!.id, participantId: ids[away]!, side: 'away' },
    ]);
    ids[`lib-${i}`] = e!.id;
    results.push({
      id: e!.id,
      homeId: ids[home]!,
      awayId: ids[away]!,
      homeGoals: hg,
      awayGoals: ag,
      group: groupOf[home]!,
      playedAt: at.toISOString(),
    });
  }
  // a tabela que o recálculo grava: o jogo adotado conta no grupo A
  const rules = await loadCompetitionRules('conmebol-libertadores', { season: 2026 });
  const tables = computeStandings({ rules, matches: results });
  await db.insert(standing).values(
    tables.flatMap((t) =>
      t.rows.map((r) => ({
        seasonId: s!.id,
        group: t.group,
        participantId: r.teamId,
        rank: r.rank,
        points: r.points,
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        goalsFor: r.goalsFor,
        goalsAgainst: r.goalsAgainst,
        source: 'computed',
      })),
    ),
  );
}

/**
 * Liga MX 2026: Clausura inteiro encerrado (18 times, 17 rodadas) com a tabela calculada dos resultados, e a
 * tabela do Apertura (17 jogos, do fornecedor e mais nova) na mesma temporada.
 */
async function seedLigaMxClausura() {
  const [mx] = await db.select().from(competition).where(eq(competition.slug, 'liga-mx'));
  const [s] = await db
    .insert(season)
    .values({ competitionId: mx!.id, label: '2026', year: 2026, current: false })
    .returning();
  const names = Array.from({ length: 18 }, (_, i) => `MX${i + 1}`);
  const teams = await db
    .insert(participant)
    .values(names.map((name) => ({ sport: 'football', kind: 'club' as const, name })))
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  // turno único pelo método do círculo; placar determinístico
  const results: (MatchResult & { label: string; at: Date })[] = [];
  const order = names.slice(1);
  const base = Date.UTC(2026, 0, 10, 20);
  for (let round = 0; round < 17; round++) {
    const ring = [names[0]!, ...order];
    for (let k = 0; k < 9; k++) {
      const [h, a] = round % 2 ? [ring[17 - k]!, ring[k]!] : [ring[k]!, ring[17 - k]!];
      results.push({
        id: `${round}-${k}`,
        homeId: ids[h]!,
        awayId: ids[a]!,
        homeGoals: (round * 7 + k * 3) % 4,
        awayGoals: (round * 5 + k) % 3,
        label: `Clausura - ${round + 1}`,
        at: new Date(base + round * 7 * 86_400_000 + k * 3_600_000),
        playedAt: new Date(base + round * 7 * 86_400_000 + k * 3_600_000).toISOString(),
      });
    }
    order.unshift(order.pop()!);
  }
  const rules = await loadCompetitionRules('liga-mx', { season: 2026 });
  const [table] = computeStandings({ rules, matches: results.map((m) => ({ ...m, group: 'Clausura' })) });
  await db.insert(standing).values([
    ...table!.rows.map((r) => ({
      seasonId: s!.id,
      group: 'Clausura',
      participantId: r.teamId,
      rank: r.rank,
      points: r.points,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      source: 'computed',
      updatedAt: new Date(base),
    })),
    // Apertura do fornecedor, atualizado depois: com a mesma soma de jogos, a escolha antiga ficava com ele
    ...names.map((team, i) => ({
      seasonId: s!.id,
      group: 'Apertura',
      participantId: ids[team]!,
      rank: i + 1,
      points: 40 - i,
      played: 17,
      source: 'provider',
      updatedAt: new Date(),
    })),
  ]);
  const stages = new Map<string, string>();
  for (const m of results) {
    let stageId = stages.get(m.label);
    if (!stageId) {
      const [st] = await db
        .insert(stage)
        .values({ seasonId: s!.id, kind: 'regular', name: { 'pt-BR': m.label }, providerLabel: m.label })
        .returning();
      stageId = st!.id;
      stages.set(m.label, stageId);
    }
    const [e] = await db
      .insert(event)
      .values({
        sport: 'football',
        competitionId: mx!.id,
        seasonId: s!.id,
        stageId,
        startsAt: m.at,
        endsAtExpected: new Date(m.at.getTime() + 7_200_000),
        status: 'finished',
        score: { home: m.homeGoals, away: m.awayGoals },
      })
      .returning();
    await db.insert(eventParticipant).values([
      { eventId: e!.id, participantId: m.homeId, side: 'home' },
      { eventId: e!.id, participantId: m.awayId, side: 'away' },
    ]);
    ids[`mx-${m.id}`] = e!.id;
  }
}

/**
 * Argentina 2027 com o regulamento real (zonas de 15, playoffs do 1º ao 8º): Apertura encerrado, Clausura na
 * 15ª rodada (14 de 16 jogos), tabela anual (30 jogos) e promedios no mesmo `core.standing`, e o 8º contra o 9º
 * da zona A do Clausura por jogar.
 */
async function seedArgentinaPhases(competitionId: string) {
  const [s] = await db
    .insert(season)
    .values({ competitionId, label: '2027', year: 2027, current: false })
    .returning();
  const zoneA = Array.from({ length: 15 }, (_, i) => `ARG-A${i + 1}`);
  const zoneB = Array.from({ length: 15 }, (_, i) => `ARG-B${i + 1}`);
  const teams = await db
    .insert(participant)
    .values([...zoneA, ...zoneB].map((name) => ({ sport: 'football', kind: 'club' as const, name })))
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  const rows = (group: string, list: string[], played: number, points: (i: number) => number) =>
    list.map((team, i) => ({
      seasonId: s!.id,
      group,
      participantId: ids[team]!,
      rank: i + 1,
      points: points(i),
      played,
      won: 0,
      drawn: 0,
      lost: 0,
      source: 'computed',
    }));
  // na anual e nos promedios, a ordem é outra (a zona A no fim)
  const annual = [...zoneB, ...[...zoneA].reverse()];
  await db
    .insert(standing)
    .values([
      ...rows('Apertura - Group A', zoneA, 16, (i) => 40 - 2 * i),
      ...rows('Apertura - Group B', zoneB, 16, (i) => 40 - 2 * i),
      ...rows('Clausura - Group A', zoneA, 14, (i) => 30 - 2 * i),
      ...rows('Clausura - Group B', zoneB, 14, (i) => 30 - 2 * i),
      ...rows('Tabla Anual', annual, 30, (i) => 60 - i),
      ...rows('Promedios', annual, 78, (i) => 150 - i),
    ]);
  const [st] = await db
    .insert(stage)
    .values({
      seasonId: s!.id,
      kind: 'regular',
      name: { 'pt-BR': 'Clausura - 15' },
      providerLabel: 'Clausura - 15',
    })
    .returning();
  const at = Date.now() + 86_400_000;
  const [e] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId,
      seasonId: s!.id,
      stageId: st!.id,
      startsAt: new Date(at),
      endsAtExpected: new Date(at + 7_200_000),
      status: 'scheduled',
    })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: e!.id, participantId: ids['ARG-A8']!, side: 'home' },
    { eventId: e!.id, participantId: ids['ARG-A9']!, side: 'away' },
  ]);
  ids.clausuraMatch = e!.id;
}

/**
 * Liguilla da Liga MX (2025): quartas de ida e volta, empate no agregado classifica o mais bem colocado na
 * tabela do torneio. Volta do Apertura com a tabela gravada (Toluca 1º, Atlas 4º); volta do Clausura sem
 * a tabela do Clausura.
 */
async function seedLiguilla() {
  const [mx] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'liga-mx', name: 'Liga MX', type: 'league' })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: mx!.id, label: '2025', year: 2025, current: true })
    .returning();
  const teams = await db
    .insert(participant)
    .values(
      ['Toluca', 'Tigres', 'Monterrey', 'Atlas'].map((name) => ({
        sport: 'football',
        kind: 'club' as const,
        name,
      })),
    )
    .returning();
  for (const t of teams) ids[t.name] = t.id;
  await db.insert(standing).values(
    ['Toluca', 'Tigres', 'Monterrey', 'Atlas'].map((team, i) => ({
      seasonId: s!.id,
      group: 'Apertura',
      participantId: ids[team]!,
      rank: i + 1,
      points: 40 - i,
      played: 17,
      source: 'provider',
    })),
  );
  const day = 86_400_000;
  const tie = async (label: string, home: string, away: string, key: string) => {
    const [st] = await db
      .insert(stage)
      .values({ seasonId: s!.id, kind: 'quarter_final', name: { 'pt-BR': label }, providerLabel: label })
      .returning();
    const legs = [
      {
        home: away,
        away: home,
        at: Date.now() - 3 * day,
        status: 'finished' as const,
        score: { home: 1, away: 1 },
      },
      { home, away, at: Date.now() + 2 * day, status: 'scheduled' as const, score: null },
    ];
    for (const [i, l] of legs.entries()) {
      const [e] = await db
        .insert(event)
        .values({
          sport: 'football',
          competitionId: mx!.id,
          seasonId: s!.id,
          stageId: st!.id,
          startsAt: new Date(l.at),
          endsAtExpected: new Date(l.at + 7_200_000),
          status: l.status,
          score: l.score,
        })
        .returning();
      await db.insert(eventParticipant).values([
        { eventId: e!.id, participantId: ids[l.home]!, side: 'home' },
        { eventId: e!.id, participantId: ids[l.away]!, side: 'away' },
      ]);
      if (i === 1) ids[key] = e!.id;
    }
  };
  await tie('Apertura - Quarter-finals', 'Toluca', 'Atlas', 'aperturaLeg2');
  await tie('Clausura - Quarter-finals', 'Tigres', 'Monterrey', 'clausuraLeg2');
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await seed();
  const t = await upsertTenant(db, {
    slug: 'tabelas',
    name: 'Tabelas',
    plan: 'enterprise',
    rateLimitPerMinute: 5000,
  });
  key = (await createApiKey(db, t.id, { env: 'test', label: 'tabelas' })).key;
  app = buildServer({ db, redis, keyPrefix, cdnPurger: new RecordingCdnPurger() });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('GET /v1/competitions/{id}/seasons/{season}/standings com tabelas do regulamento', () => {
  it('fases na ordem do regulamento, anual e promedios com papel, nome no idioma e a fase em andamento', async () => {
    const body = await get<Standings>(
      '/v1/competitions/argentina-liga-profesional/seasons/2026/standings?locale=es-AR',
    );
    expect(
      body.groups.map((g) => [g.name, g.display_name, g.table, g.table_key, g.current, g.source]),
    ).toEqual([
      ['Apertura - Group A', 'Apertura · Zona A', 'phase', 'apertura', false, 'provider'],
      ['Apertura - Group B', 'Apertura · Zona B', 'phase', 'apertura', false, 'provider'],
      ['Clausura - Group A', 'Clausura · Zona A', 'phase', 'clausura', true, 'computed'],
      ['Clausura - Group B', 'Clausura · Zona B', 'phase', 'clausura', true, 'computed'],
      ['Tabla Anual', 'Tabla anual', 'annual', 'annual', false, 'computed'],
      ['Promedios', 'Promedios', 'relegation_average', 'promedios', false, 'provider'],
      [null, null, null, null, false, 'provider'],
    ]);
    const pt = await get<Standings>(
      '/v1/competitions/argentina-liga-profesional/seasons/2026/standings?locale=pt-BR',
    );
    expect(pt.groups[2]!.display_name).toBe('Clausura · Grupo A');
  });

  it('overview do time: a posição é a da fase em andamento, não a anual nem os promedios', async () => {
    const body = await get<TeamOverview>(`/v1/teams/${ids['Boca Juniors']}/overview?locale=es-AR`);
    const arg = body.standings.find((s) => s.competition.slug === 'argentina-liga-profesional');
    expect(arg).toMatchObject({
      group: 'Clausura - Group A',
      group_display_name: 'Clausura · Zona A',
      rank: 2,
      played: 9,
    });
  });
});

describe('GET /v1/events/{id}: Liguilla decidida pela campanha', () => {
  const codes = (e: { stakes: { team: string; code: string }[] }) =>
    e.stakes.map((x) => `${x.team}:${x.code}`);

  it('volta com agregado empatado: o mais bem colocado no Apertura passa com o empate, sem pênaltis', async () => {
    const e = await get<{ stakes: { team: string; code: string }[] }>(`/v1/events/${ids.aperturaLeg2}`);
    // antes: a API chamava o motor sem a posição e anunciava pênaltis, que a fase não tem
    expect(codes(e)).toContain('home:advances_with_draw');
    expect(codes(e)).toContain('away:needs_win');
    expect(codes(e).some((c) => c.includes('penalties') || c.includes('extra_time'))).toBe(false);
  });

  it('sem a tabela de referência (Clausura): sem stakes, nunca pênaltis', async () => {
    const e = await get<{ stakes: { team: string; code: string }[] }>(`/v1/events/${ids.clausuraLeg2}`);
    expect(e.stakes).toEqual([]);
  });
});

describe('GET /v1/events/{id}: pontos corridos na tabela da fase do jogo', () => {
  it('jogo do Clausura usa a zona do Clausura (15 times, playoffs 1 a 8), não a anual nem os promedios', async () => {
    const e = await get<{ stakes: { team: string; code: string }[]; competition_context: string[] }>(
      `/v1/events/${ids.clausuraMatch}?stakes=all`,
    );
    // antes: a de mais jogos somados (os promedios), com a matemática da liga inteira (30 times, sem zonas):
    // nenhum stake
    expect(e.stakes.map((x) => `${x.team}:${x.code}`)).toEqual([
      'home:clinches_playoffs_with_win',
      'away:can_qualify_for_playoffs',
    ]);
  });
});

describe('GET /v1/events/{id}: jogo encerrado na tabela da fase', () => {
  it('Liga MX: última rodada do Clausura com a tabela e os resultados do Clausura', async () => {
    const e = await get<{ stakes: { team: string; code: string }[] }>(
      `/v1/events/${ids['mx-16-4']}?stakes=all`,
    );
    // antes: a tabela do Apertura (mais nova, mesma soma de jogos) contra os resultados da temporada inteira não
    // batia, e o jogo ficava sem stakes; agora, o que estava em jogo e o que o resultado mudou no Clausura
    expect(e.stakes.map((x) => `${x.team}:${x.code}`)).toEqual([
      'home:clinches_liguilla_with_win',
      'away:clinches_liguilla_with_win',
      'home:stayed_at_7',
      'home:lost_liguilla_chance',
      'home:points_behind_liguilla_1',
      'away:moved_up_to_5',
      'away:clinched_play_in',
    ]);
  });
});

describe('GET /v1/events/{id}: jogo encerrado de grupo com rodada desconhecida adotada', () => {
  it('a tabela de antes fecha com os jogos que o recálculo soma no grupo', async () => {
    const codes = async (k: number) =>
      (
        await get<{ stakes: { team: string; code: string }[] }>(`/v1/events/${ids[`lib-${k}`]}?stakes=all`)
      ).stakes.map((x) => `${x.team}:${x.code}`);
    // antes: sem o jogo adotado nos resultados da fase, a conta não fechava e o grupo ficava sem stakes
    expect(await codes(5)).toEqual([
      'home:stayed_at_3',
      'home:points_behind_round_of_16_2',
      'away:stayed_at_4',
      'away:points_behind_sudamericana_knockout_playoff_0',
    ]);
    // o próprio jogo adotado
    expect(await codes(4)).toEqual(['home:moved_up_to_1', 'away:moved_down_to_2']);
  });
});
