/**
 * F1DB como segunda fonte da F1: casa com a api-sports já gravada (mesma corrida, piloto, equipe e circuito viram
 * uma entidade só), cria o histórico que falta, não duplica na reimportação e uma sessão da api-sports que chega
 * depois assume o evento que o F1DB criou.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { country, sport, type Database } from '@galaxie/db';
import {
  F1DB_TABLES,
  normalizeF1RaceRanking,
  normalizeF1Races,
  type F1dbRow,
  type F1dbTables,
} from '@galaxie/providers';
import { importF1db } from '../src/f1db/import.js';
import { loadF1dbRaw, storeF1dbRelease } from '../src/f1db/package-raw.js';
import { upsertBatch } from '../src/normalize/upsert-core.js';
import { disposableDb } from './db.js';

const testDb = disposableDb();
let db: Database;
const AT = new Date('2026-10-21T10:00:00Z');
const F1DB_AT = new Date('2026-10-22T10:00:00Z');

const BRAZIL = {
  gp: { id: 22, name: 'Brazil Grand Prix', location: { city: 'São Paulo', country: 'Brazil' } },
  circuit: { id: 22, name: 'Autódromo José Carlos Pace' },
};
const SINGAPORE = {
  gp: { id: 17, name: 'Singapore Grand Prix', location: { city: 'Singapore', country: 'Singapore' } },
  circuit: { id: 17, name: 'Marina Bay Street Circuit' },
};

const apiRace = (id: number, type: string, date: string, where = BRAZIL) => ({
  id,
  competition: where.gp,
  circuit: where.circuit,
  season: Number(date.slice(0, 4)),
  type,
  date,
  status: 'Completed',
  laps: { total: 69, current: null },
});

const ranking = (race: number, position: number, driver: [number, string], team: [number, string]) => ({
  race: { id: race },
  driver: { id: driver[0], name: driver[1] },
  team: { id: team[0], name: team[1] },
  position,
  time: position === 1 ? '1:32:59.000' : `+${position}.000`,
  laps: 69,
  grid: position,
  pits: 2,
});

const result = (raceId: number, position: number, driver: string, constructor: string): F1dbRow => ({
  race_id: raceId,
  type: 'RACE_RESULT',
  position_display_order: position,
  position_number: position,
  position_text: String(position),
  driver_id: driver,
  constructor_id: constructor,
  race_laps: 69,
});

/** Release mínimo: Brasil 2024 (a api-sports já tem), Japão 1988 e Singapura 2026 (só no F1DB). */
function tables(): F1dbTables {
  return {
    country: [{ id: 'brazil', alpha2_code: 'BR', name: 'Brazil' }],
    driver: [
      { id: 'max-verstappen', name: 'Max Verstappen', abbreviation: 'VER' },
      { id: 'esteban-ocon', name: 'Esteban Ocon', abbreviation: 'OCO' },
      { id: 'ayrton-senna', name: 'Ayrton Senna', abbreviation: 'SEN', nationality_country_id: 'brazil' },
      { id: 'alain-prost', name: 'Alain Prost', abbreviation: 'PRO' },
    ],
    constructor: [
      { id: 'red-bull', name: 'Red Bull', full_name: 'Red Bull Racing' },
      { id: 'alpine', name: 'Alpine', full_name: 'Alpine F1 Team' },
      { id: 'mclaren', name: 'McLaren', full_name: 'McLaren Racing' },
    ],
    circuit: [
      {
        id: 'interlagos',
        name: 'José Carlos Pace',
        full_name: 'Autódromo José Carlos Pace',
        place_name: 'São Paulo',
        country_id: 'brazil',
        longitude: -46.7,
      },
      { id: 'suzuka', name: 'Suzuka', full_name: 'Suzuka Circuit', place_name: 'Suzuka', longitude: 136.5 },
      {
        id: 'marina-bay',
        name: 'Marina Bay',
        full_name: 'Marina Bay Street Circuit',
        place_name: 'Singapore',
        longitude: 103.9,
      },
    ],
    grand_prix: [
      { id: 'sao-paulo', full_name: 'São Paulo Grand Prix' },
      { id: 'japan', full_name: 'Japanese Grand Prix' },
      { id: 'singapore', full_name: 'Singapore Grand Prix' },
    ],
    race: [
      {
        id: 1100,
        year: 2024,
        round: 21,
        date: '2024-11-03',
        time: '15:30',
        grand_prix_id: 'sao-paulo',
        circuit_id: 'interlagos',
        laps: 69,
      },
      {
        id: 470,
        year: 1988,
        round: 15,
        date: '1988-10-30',
        grand_prix_id: 'japan',
        circuit_id: 'suzuka',
        laps: 51,
      },
      {
        id: 1166,
        year: 2026,
        round: 17,
        date: '2026-10-11',
        time: '12:00',
        grand_prix_id: 'singapore',
        circuit_id: 'marina-bay',
        laps: 62,
      },
    ],
    race_data: [
      result(1100, 1, 'max-verstappen', 'red-bull'),
      result(1100, 2, 'esteban-ocon', 'alpine'),
      result(470, 1, 'ayrton-senna', 'mclaren'),
      result(470, 2, 'alain-prost', 'mclaren'),
      { race_id: 470, type: 'PIT_STOP', driver_id: 'alain-prost', pit_stop_stop: 1, pit_stop_lap: 30 },
      result(1166, 1, 'max-verstappen', 'red-bull'),
      result(1166, 2, 'esteban-ocon', 'alpine'),
    ],
    season_constructor: [
      { year: 2024, constructor_id: 'red-bull' },
      { year: 2024, constructor_id: 'alpine' },
    ],
    season_driver_standing: [
      { year: 1988, position_number: 1, driver_id: 'ayrton-senna', points: 90 },
      { year: 1988, position_number: 2, driver_id: 'alain-prost', points: 87 },
    ],
    season_constructor_standing: [{ year: 1988, position_number: 1, constructor_id: 'mclaren', points: 199 }],
  };
}

const count = async (q: ReturnType<typeof sql>) => Number((await db.execute<{ n: string }>(q))[0]!.n);
/** Evento solto com espelho que já usa a identidade api-sports/<id> (duplicata antiga). */
async function orphanMirror(providerEventId: string): Promise<string> {
  const [orphan] = await db.execute<{ id: string }>(sql`
    insert into core.event (id, sport, starts_at, ends_at_expected)
    values (gen_random_uuid(), 'formula-1', now(), now()) returning id::text as id`);
  await db.execute(sql`
    insert into core.sport_event_detail (event_id, sport, provider, provider_event_id, kind, summary)
    values (${orphan!.id}::uuid, 'formula-1', 'api-sports', ${providerEventId}, 'race', '{}'::jsonb)`);
  return orphan!.id;
}

const entityOf = async (provider: string, type: string, providerId: string) =>
  (
    await db.execute<{ id: string }>(sql`
      select entity_id::text as id from core.provider_map
       where provider = ${provider} and sport = 'formula-1' and entity_type = ${type} and provider_id = ${providerId}`)
  )[0]?.id;

beforeAll(async () => {
  db = await testDb.setup();
  await db.insert(sport).values({ slug: 'formula-1', name: { 'pt-BR': 'Fórmula 1' } });
  // a F1 de 2024 da api-sports: sprint e corrida do GP do Brasil, com a classificação da corrida
  await upsertBatch(
    db,
    normalizeF1Races(
      [
        apiRace(1956, 'Sprint', '2024-11-02T14:00:00+00:00'),
        apiRace(1957, 'Race', '2024-11-03T15:30:00+00:00'),
      ],
      AT,
    ),
    { derbyLookup: false },
  );
  await upsertBatch(
    db,
    normalizeF1RaceRanking(
      'results',
      [
        ranking(1957, 1, [25, 'Max Verstappen'], [1, 'Red Bull Racing']),
        ranking(1957, 2, [28, 'Esteban Ocon'], [13, 'Alpine F1 Team']),
      ],
      AT,
    ),
    { derbyLookup: false },
  );
}, 120_000);

afterAll(() => testDb.teardown());

describe('importação do F1DB', () => {
  it('casa com a api-sports e cria só o histórico que falta', async () => {
    const r = await importF1db(db, { tables: tables(), release: 'v-test', observedAt: F1DB_AT });
    expect(r.match.racesMatched).toBe(1);
    expect(r.linked.competition).toBe(true);
    // mesma entidade para piloto, equipe, circuito e sessão
    expect(await entityOf('f1db', 'participant', 'driver-max-verstappen')).toBe(
      await entityOf('api-sports', 'participant', 'driver-25'),
    );
    expect(await entityOf('f1db', 'participant', 'red-bull')).toBe(
      await entityOf('api-sports', 'participant', '1'),
    );
    expect(await entityOf('f1db', 'venue', 'interlagos')).toBe(await entityOf('api-sports', 'venue', '22'));
    expect(await entityOf('f1db', 'event', 'race-1100-race')).toBe(
      await entityOf('api-sports', 'event', '1957'),
    );
    // GP do Brasil coberto: nenhuma sessão nova; Japão 1988 e Singapura 2026 entram (só corrida)
    expect(await count(sql`select count(*) as n from core.event where sport = 'formula-1'`)).toBe(4);
    expect(
      await count(
        sql`select count(*) as n from core.participant where sport = 'formula-1' and kind = 'driver'`,
      ),
    ).toBe(4);
    // o evento da api-sports continua dela (estado e classificação)
    const owner = await db.execute<{ source_provider: string; n: string }>(sql`
      select e.source_provider, (select count(*) from core.event_participant ep where ep.event_id = e.id) as n
        from core.event e where e.id = ${await entityOf('api-sports', 'event', '1957')}::uuid`);
    expect(owner[0]).toMatchObject({ source_provider: 'api-sports', n: '2' });
    // 1988: campeonato e a corrida com pit stop no espelho
    const senna = await db.execute<{ rank: number; points: number }>(sql`
      select s.rank, s.points from core.standing s join core.season se on se.id = s.season_id
       where se.year = 1988 and s.group = 'drivers' and s.participant_id = ${await entityOf('f1db', 'participant', 'driver-ayrton-senna')}::uuid`);
    expect(senna[0]).toMatchObject({ rank: 1, points: 90 });
    const japan = await db.execute<{ pits: number; source: string }>(sql`
      select jsonb_array_length(sd.detail->'pit_stops') as pits, sd.summary->>'source' as source
        from core.sport_event_detail sd where sd.event_id = ${await entityOf('f1db', 'event', 'race-470-race')}::uuid`);
    expect(japan[0]).toMatchObject({ pits: 1, source: 'f1db' });
  });

  it('reimportar o mesmo release não cria nem muda nada', async () => {
    const r = await importF1db(db, { tables: tables(), release: 'v-test', observedAt: F1DB_AT });
    expect(r.linked).toMatchObject({ participants: 0, venues: 0, events: 0, competition: false });
    expect(r.upsert.events.inserted).toBe(0);
    expect(r.upsert.events.updated).toBe(0);
    expect(await count(sql`select count(*) as n from core.event where sport = 'formula-1'`)).toBe(4);
  });

  it('prévia desfaz tudo', async () => {
    const before = await count(sql`select count(*) as n from core.provider_map`);
    const t = tables();
    t.race!.push({
      id: 471,
      year: 1988,
      round: 16,
      date: '1988-11-13',
      grand_prix_id: 'japan',
      circuit_id: 'suzuka',
    });
    t.race_data!.push(result(471, 1, 'alain-prost', 'mclaren'));
    const r = await importF1db(db, { tables: t, release: 'v-test', observedAt: F1DB_AT, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.upsert.events.inserted).toBe(1);
    expect(await count(sql`select count(*) as n from core.provider_map`)).toBe(before);
    expect(await count(sql`select count(*) as n from core.event where sport = 'formula-1'`)).toBe(4);
  });

  it('dois IDs do F1DB na mesma entidade entram como uma linha só e a prévia avisa', async () => {
    // "Red Bull Racing" como outro construtor do F1DB (como RB → Racing Bulls): casa com a mesma equipe da
    // api-sports pelo nome exato, e os dois caem no mesmo lote pelos campeonatos de 2025 e 2026. O país (lacuna
    // da equipe) faz o upsert mexer na linha: sem juntar, o Postgres recusa a mesma linha duas vezes no insert
    await db
      .insert(country)
      .values({ code: 'AT', name: { en: 'Austria' } })
      .onConflictDoNothing();
    const t = tables();
    t.country!.push({ id: 'austria', alpha2_code: 'AT', name: 'Austria' });
    t.constructor!.find((c) => c.id === 'red-bull')!.country_id = 'austria';
    t.constructor!.push({
      id: 'red-bull-racing',
      name: 'Red Bull Racing',
      full_name: 'Red Bull Racing',
      country_id: 'austria',
    });
    t.season_constructor!.push(
      { year: 2025, constructor_id: 'red-bull' },
      { year: 2026, constructor_id: 'red-bull-racing' },
    );
    t.season_constructor_standing!.push(
      { year: 2025, position_number: 1, constructor_id: 'red-bull', points: 500 },
      { year: 2026, position_number: 1, constructor_id: 'red-bull-racing', points: 400 },
    );
    const redBull = await entityOf('api-sports', 'participant', '1');
    const before = await count(sql`select count(*) as n from core.provider_map`);
    const preview = await importF1db(db, { tables: t, release: 'v-test', observedAt: F1DB_AT, dryRun: true });
    expect(preview.shared).toEqual([
      { entityId: redBull, name: 'Red Bull Racing', f1dbIds: ['red-bull', 'red-bull-racing'] },
    ]);
    expect(await count(sql`select count(*) as n from core.provider_map`)).toBe(before);

    const r = await importF1db(db, { tables: t, release: 'v-test', observedAt: F1DB_AT });
    expect(r.shared).toHaveLength(1);
    expect(await entityOf('f1db', 'participant', 'red-bull-racing')).toBe(redBull);
    const standings = await db.execute<{ year: number; points: number }>(sql`
      select se.year, s.points from core.standing s join core.season se on se.id = s.season_id
       where s.group = 'constructors' and s.participant_id = ${redBull}::uuid order by se.year`);
    expect(standings.map((s) => [Number(s.year), Number(s.points)])).toEqual([
      [2025, 500],
      [2026, 400],
    ]);
    // o nome continua o da api-sports (o F1DB só preenche lacunas de equipe casada)
    const name = await db.execute<{ name: string }>(
      sql`select name from core.participant where id = ${redBull}::uuid`,
    );
    expect(name[0]!.name).toBe('Red Bull Racing');
  });

  it('sessão da api-sports que chega depois assume o evento criado pelo F1DB', async () => {
    const f1dbEvent = await entityOf('f1db', 'event', 'race-1166-race');
    const before = await db.execute<{ provider: string; detail: unknown }>(
      sql`select provider, detail from core.sport_event_detail where event_id = ${f1dbEvent}::uuid`,
    );
    expect(before[0]!.provider).toBe('f1db');
    const stats = await upsertBatch(
      db,
      normalizeF1Races(
        [apiRace(2100, 'Race', '2026-10-11T12:00:00+00:00', SINGAPORE)],
        new Date('2026-10-23T10:00:00Z'),
      ),
      { derbyLookup: false },
    );
    expect(stats.events.matchedAcrossProviders).toBe(1);
    expect(stats.events.inserted).toBe(0);
    expect(await entityOf('api-sports', 'event', '2100')).toBe(f1dbEvent);
    const e = await db.execute<{ source_provider: string; n: string }>(sql`
      select source_provider, (select count(*) from core.event_participant ep where ep.event_id = e.id) as n
        from core.event e where e.id = ${f1dbEvent}::uuid`);
    // a api-sports vira dona do estado; os pilotos do F1DB ficam até ela mandar a classificação
    expect(e[0]).toMatchObject({ source_provider: 'api-sports', n: '2' });
    // o espelho troca de identidade junto com o resumo (antes ficava com o id do F1DB e o resumo da api-sports);
    // o detalhe já gravado fica
    const [mirror] = await db.execute<{
      provider: string;
      provider_event_id: string;
      kind: string;
      summary_id: string | null;
    }>(sql`
      select provider, provider_event_id, kind, summary->>'id' as summary_id
        from core.sport_event_detail where event_id = ${f1dbEvent}::uuid`);
    expect(mirror).toEqual({
      provider: 'api-sports',
      provider_event_id: '2100',
      kind: 'race',
      summary_id: '2100',
    });
    expect(before[0]!.detail).toEqual(
      (
        await db.execute<{ detail: unknown }>(
          sql`select detail from core.sport_event_detail where event_id = ${f1dbEvent}::uuid`,
        )
      )[0]!.detail,
    );
  });

  it('com o horário estimado do F1DB (antes de 2024), a sessão da api-sports casa pelo dia', async () => {
    const japan = await entityOf('f1db', 'event', 'race-470-race');
    const [e] = await db.execute<{ starts_at: string; estimated: boolean | null }>(sql`
      select e.starts_at, (sd.summary->>'time_estimated')::boolean as estimated
        from core.event e join core.sport_event_detail sd on sd.event_id = e.id
       where e.id = ${japan}::uuid`);
    expect(e!.estimated).toBe(true);
    // a api-sports diz 5 h depois do estimado (Bahrein 2022: 11h estimado, 15h real): fora dos ±3 h, no mesmo dia
    const real = new Date(new Date(e!.starts_at).getTime() + 5 * 3_600_000).toISOString();
    // espelho órfão de outro evento já com a identidade api-sports/2200 (duplicata antiga): a troca de
    // identidade violaria sport_event_detail_provider_uq e derrubaria o lote; o espelho do evento fica como estava
    const orphan = await orphanMirror('2200');
    const [beforeMirror] = await db.execute<{ provider: string; summary: unknown }>(
      sql`select provider, summary from core.sport_event_detail where event_id = ${japan}::uuid`,
    );
    const stats = await upsertBatch(
      db,
      normalizeF1Races([apiRace(2200, 'Race', real)], new Date('2026-10-23T11:00:00Z')),
      { derbyLookup: false },
    );
    expect(stats.events.matchedAcrossProviders).toBe(1);
    expect(stats.events.inserted).toBe(0);
    expect(stats.events.mirrorIdentityTaken).toBe(1);
    expect(await entityOf('api-sports', 'event', '2200')).toBe(japan);
    // nem identidade de um com resumo do outro: o espelho inteiro fica como estava
    const [mirror] = await db.execute<{ provider: string; summary: unknown }>(
      sql`select provider, summary from core.sport_event_detail where event_id = ${japan}::uuid`,
    );
    expect(mirror).toEqual(beforeMirror);
    expect(mirror!.provider).toBe('f1db');
    await db.execute(sql`delete from core.event where id = ${orphan}::uuid`);
  });

  it('evento novo sem espelho cuja identidade já é de um espelho órfão: o lote passa, sem o espelho', async () => {
    const orphan = await orphanMirror('2400');
    const stats = await upsertBatch(
      db,
      normalizeF1Races(
        [apiRace(2400, 'Race', '2026-06-01T12:00:00+00:00')],
        new Date('2026-10-23T12:00:00Z'),
      ),
      { derbyLookup: false },
    );
    expect(stats.events.inserted).toBe(1);
    expect(stats.events.mirrorIdentityTaken).toBe(1);
    const created = await entityOf('api-sports', 'event', '2400');
    const mirrors = await db.execute<{ n: string }>(
      sql`select count(*) as n from core.sport_event_detail where event_id = ${created}::uuid`,
    );
    expect(mirrors[0]!.n).toBe('0');
    await db.execute(sql`delete from core.event where id = ${orphan}::uuid`);
  });

  it('cria o país do F1DB que o core não tem (Mônaco não é da FIFA) e não mexe nos que existem', async () => {
    const t = tables();
    t.country = [...t.country!, { id: 'monaco', alpha2_code: 'MC', name: 'Monaco' }];
    t.driver = [
      ...t.driver!,
      {
        id: 'charles-leclerc',
        name: 'Charles Leclerc',
        abbreviation: 'LEC',
        nationality_country_id: 'monaco',
      },
    ];
    const r = await importF1db(db, { tables: t, release: 'v-test', observedAt: F1DB_AT });
    expect(r.countries).toEqual(['MC']);
    const rows = await db.execute<{ code: string; name: Record<string, string> }>(
      sql`select code, name from core.country where code in ('MC', 'BR') order by code`,
    );
    expect(rows.find((c) => c.code === 'MC')!.name).toEqual({
      en: 'Monaco',
      'pt-BR': 'Mônaco',
      es: 'Mónaco',
    });
    expect((await importF1db(db, { tables: t, release: 'v-test', observedAt: F1DB_AT })).countries).toEqual(
      [],
    );
  });
});

describe('raw do release', () => {
  it('grava o SQLite no raw em fluxo, sem as colunas nulas, e não grava de novo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'f1db-'));
    const path = join(dir, 'f1db.db');
    const sqlite = new DatabaseSync(path);
    for (const table of F1DB_TABLES)
      sqlite.exec(`CREATE TABLE "${table}" (id TEXT, year INTEGER, note TEXT)`);
    const insert = sqlite.prepare('INSERT INTO "race" (id, year, note) VALUES (?, ?, ?)');
    insert.run('470', 1988, 'Suzuka');
    insert.run('1100', 2024, null);
    sqlite.close();
    try {
      const first = await storeF1dbRelease(db, path, 'v-raw');
      expect(first.inserted).toBe(F1DB_TABLES.length);
      expect((await storeF1dbRelease(db, path, 'v-raw')).inserted).toBe(0);
      const raw = await loadF1dbRaw(db, first.sha256);
      expect(raw.release).toBe('v-raw');
      expect(raw.tables.race).toEqual([
        { id: '470', year: 1988, note: 'Suzuka' },
        { id: '1100', year: 2024 },
      ]);
      expect(raw.tables.driver).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
