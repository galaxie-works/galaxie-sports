import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiResponse,
  eqAthlete,
  eqCompetition,
  eqHorse,
  eqImportRun,
  eqResult,
  eqRound,
  participant,
  providerMap,
  type Database,
} from '@galaxie/db';
import { normalizePackage } from '../src/equestrian/normalize.js';
import { loadPackageRaw, readPackage, storePackageRaw } from '../src/equestrian/package-raw.js';
import { persistEquestrian } from '../src/equestrian/persist.js';
import { disposableDb } from './db.js';

const SOURCE = 'fei-public-test';
const { setup, teardown } = disposableDb();
let db: Database;
let dir: string;
let sqlitePath: string;

/** Pacote mínimo no mesmo formato do SQLite V3 (só as colunas usadas). */
async function writePackage(path: string, position: string) {
  const { DatabaseSync } = await import('node:sqlite');
  const s = new DatabaseSync(path);
  s.exec(`
    create table schema_migrations(version integer primary key, name text, applied_at text);
    insert into schema_migrations values (8, 'v3', '2026-10-23');
    create table athletes(athlete_fei_id text primary key, athlete_name text, represented_country_current text,
      performance_url text, displayed_total text, collected_jumping_results integer, verified_all_displayed_pages integer,
      collected_at_utc text);
    insert into athletes values ('10000380', 'WERTHEIN, Lucas', 'ARG',
      'https://data.fei.org/Person/Performance.aspx?personFEIID=10000380', '2 Competition(s) / 1 Page(s)', 2, 1,
      '2026-10-22T18:41:07Z');
    create table horses(horse_fei_id text primary key, horse_name text, profile_status text,
      birth_date_iso_as_published text, gender text, castrated text, breed text, profile_source_url text);
    insert into horses values ('NED04702', 'WARREN', 'public_detail_observed', '1994-01-01', 'Male', 'Yes', 'KWPN', null);
    create table competitions(competition_id text primary key, name text, event_category_raw text, date_raw text,
      venue_raw text, event_country text, article text, all_entries_observed integer, source_url text);
    insert into competitions values ('c-athens', 'Final Classification', 'Olympic Games-S', '19/08/2004', 'Athens',
      'GRE', 'Hist', 0, 'https://data.fei.org/Result/ResultList.aspx?p=x');
    create table results(result_id text primary key, athlete_fei_id text, athlete_name text,
      represented_country_current text, date_iso text, horse_fei_id text, horse_name text, position_raw text,
      position integer, status text, score_raw text, score_parse_status text, quality_flags text);
    insert into results values ('r-athens', '10000380', 'WERTHEIN, Lucas', 'ARG', '2004-08-19', 'NED04702', 'WARREN',
      '${position}', ${Number(position)}, 'classified', null, 'missing', 'missing_score');
    create table result_entities(result_id text primary key, horse_fei_id text, competition_id text);
    insert into result_entities values ('r-athens', 'NED04702', 'c-athens');
    create table official_round_observations(round_observation_id text primary key, event_key text, stage text,
      date_iso text, athlete_fei_id text, athlete_name text, horse_fei_id text, horse_name text, penalties_jumping
      integer, penalties_time integer, penalties_total integer, status text, source_url text, source_pdf_page integer);
    insert into official_round_observations values ('ro-1', 'athens_2004_jumping', 'qualifier_1', '2004-08-22',
      '10000380', 'Lucas WERTHEIN', 'NED04702', 'WARREN', 8, 1, 9, 'completed', 'https://digital.la84.org/x', 92),
      ('ro-2', 'athens_2004_jumping', 'qualifier_2', '2004-08-24', '10000380', 'Lucas WERTHEIN', 'NED04702', 'WARREN',
      null, null, null, 'EL', 'https://digital.la84.org/x', 96);
  `);
  s.close();
}

async function importOnce(path: string) {
  const pkg = await readPackage(path);
  const pages = await storePackageRaw(db, SOURCE, pkg);
  const tables = await loadPackageRaw(db, SOURCE, pkg.sha256);
  const [run] = await db
    .insert(eqImportRun)
    .values({ source: SOURCE, license: 'test', packageName: 'test.sqlite', packageSha256: pkg.sha256 })
    .returning({ id: eqImportRun.id });
  const counts = await persistEquestrian(db, normalizePackage(tables), {
    source: SOURCE,
    importRunId: run!.id,
  });
  return { pages, counts };
}

beforeAll(async () => {
  db = await setup();
  dir = mkdtempSync(join(tmpdir(), 'equestrian-'));
  sqlitePath = join(dir, 'pacote.sqlite');
  await writePackage(sqlitePath, '71');
}, 120_000);

afterAll(async () => {
  await teardown();
  rmSync(dir, { recursive: true, force: true });
});

describe('importação do pacote de hipismo', () => {
  it('grava o pacote no raw, normaliza e persiste com fonte e cobertura', async () => {
    const { pages, counts } = await importOnce(sqlitePath);
    expect(pages).toBeGreaterThan(0);
    expect(counts).toMatchObject({ athletes: 1, results: 1, rounds: 2, participantsCreated: 1 });

    const [a] = await db.select().from(eqAthlete).where(eq(eqAthlete.feiId, '10000380'));
    expect(a).toMatchObject({
      displayName: 'Lucas Werthein',
      historyCoverage: 'complete',
      competingFor: 'ARG',
    });
    const [p] = await db.select().from(participant).where(eq(participant.id, a!.participantId!));
    expect(p).toMatchObject({ sport: 'equestrian', kind: 'athlete', name: 'Lucas Werthein' });

    const [h] = await db.select().from(eqHorse).where(eq(eqHorse.feiId, 'NED04702'));
    expect(h).toMatchObject({ gender: 'gelding', breed: 'KWPN', profileStatus: 'detailed' });

    const [r] = await db.select().from(eqResult).where(eq(eqResult.sourceKey, 'r-athens'));
    // ausente não é zero
    expect(r).toMatchObject({
      position: 71,
      scoreRaw: null,
      penalties: null,
      timeSeconds: null,
      status: 'classified',
    });
    const [k] = await db.select().from(eqCompetition).where(eq(eqCompetition.id, r!.competitionId!));
    expect(k).toMatchObject({ level: 'Olympic Games-S', date: '2004-08-19' });

    const rounds = await db.select().from(eqRound).where(eq(eqRound.athleteId, a!.id));
    expect(rounds.map((x) => [x.stage, x.status, x.score]).sort()).toEqual([
      ['qualifier_1', 'completed', '9.00'],
      ['qualifier_2', 'EL', null],
    ]);
  });

  it('reimportar o mesmo pacote não duplica nada (nem raw, nem participante)', async () => {
    const { pages, counts } = await importOnce(sqlitePath);
    expect(pages).toBe(0);
    expect(counts.participantsCreated).toBe(0);
    expect(await db.$count(eqResult)).toBe(1);
    expect(await db.$count(eqRound)).toBe(2);
    expect(await db.$count(eqAthlete)).toBe(1);
    expect(
      await db.$count(
        providerMap,
        and(
          eq(providerMap.provider, 'fei'),
          eq(providerMap.sport, 'equestrian'),
          eq(providerMap.providerId, '10000380'),
        ),
      ),
    ).toBe(1);
  });

  it('um pacote novo da mesma fonte atualiza a mesma classificação', async () => {
    const v2 = join(dir, 'pacote-v2.sqlite');
    await writePackage(v2, '70');
    await importOnce(v2);
    expect(await db.$count(eqResult)).toBe(1);
    const [r] = await db.select().from(eqResult).where(eq(eqResult.sourceKey, 'r-athens'));
    expect(r!.position).toBe(70);
    expect(await db.$count(apiResponse, eq(apiResponse.provider, SOURCE))).toBeGreaterThan(0);
  });
});
