/**
 * Títulos do Wikidata (titulos:wikidata): a substituição por competição não apaga o histórico quando a consulta
 * vem sem edições ou com bem menos títulos que os gravados. Sem rede: as linhas são montadas no teste.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { competition, competitionTitle, competitionTitleCoverage, sport, type Database } from '@galaxie/db';
import {
  coverageOf,
  saveTitles,
  titleDropGuard,
  type Edition,
  type TitleRow,
} from '../src/titles/wikidata-titles.js';
import { disposableDb } from './db.js';

const testDb = disposableDb();
let db: Database;
let libertadores: string;

beforeAll(async () => {
  db = await testDb.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [c] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'conmebol-libertadores', name: 'Libertadores', type: 'cup' })
    .returning({ id: competition.id });
  libertadores = c!.id;
}, 60_000);
afterAll(() => testDb.teardown());

const COMPETITION = { qid: 'Q184795' };
const editions = (years: number[]): Edition[] =>
  years.map((y) => ({
    qid: `Q${y}`,
    competitionQid: COMPETITION.qid,
    label: `${y} Copa Libertadores`,
    winners: [`QW${y}`],
    seasonYear: y,
    seasonLabel: String(y),
    decidedOn: `${y}-11-30`,
    winnerInParticipants: null,
    source: 'wikidata',
  }));
const rowsOf = (list: Edition[]): TitleRow[] =>
  list.map((e) => ({
    competitionId: libertadores,
    participantId: null,
    seasonYear: e.seasonYear!,
    seasonLabel: e.seasonLabel!,
    decidedOn: e.decidedOn!,
    editionQid: e.qid,
    winnerQid: e.winners[0]!,
    competitionQid: COMPETITION.qid,
    source: 'wikidata',
    sourceRef: null,
  }));
const save = (list: Edition[], options?: { allowDrop?: boolean }) =>
  saveTitles(db, rowsOf(list), new Map(), [coverageOf(COMPETITION, libertadores, list)], new Map(), options);
const stored = async () =>
  (
    await db
      .select({ year: competitionTitle.seasonYear })
      .from(competitionTitle)
      .where(eq(competitionTitle.competitionId, libertadores))
  )
    .map((r) => r.year)
    .sort();
const coverage = async () =>
  (
    await db
      .select({ through: competitionTitleCoverage.completeThrough })
      .from(competitionTitleCoverage)
      .where(eq(competitionTitleCoverage.competitionId, libertadores))
  )[0]?.through;

describe('títulos: proteção contra a fonte vazia', () => {
  const years = [2015, 2016, 2017, 2018, 2019, 2020];

  it('grava e substitui normalmente (uma edição a menos é troca legítima)', async () => {
    expect(await save(editions(years))).toMatchObject({ titles: 6, skipped: [] });
    expect(await stored()).toEqual(years);
    expect(await save(editions(years.slice(1)))).toMatchObject({ titles: 5, skipped: [] });
    expect(await stored()).toEqual(years.slice(1));
  });

  it('consulta sem edições: o histórico e a cobertura ficam, com o motivo (e a prévia já mostra)', async () => {
    const before = await coverage();
    expect(await titleDropGuard(db, [], [coverageOf(COMPETITION, libertadores, [])])).toEqual([
      { competitionId: libertadores, reason: 'a fonte veio vazia e há 5 gravado(s)' },
    ]);
    const r = await save([]);
    expect(r.titles).toBe(0);
    expect(r.skipped).toEqual([
      { competitionId: libertadores, reason: 'a fonte veio vazia e há 5 gravado(s)' },
    ]);
    expect(await stored()).toEqual(years.slice(1));
    expect(await coverage()).toBe(before);
  });

  it('queda abrupta (menos da metade): fica como estava; --aceitar-queda grava', async () => {
    const r = await save(editions([2020]));
    expect(r.skipped[0]?.reason).toMatch(/queda abrupta: 5 gravado\(s\), a fonte trouxe 1/);
    expect(await stored()).toEqual(years.slice(1));
    expect(await save(editions([2020]), { allowDrop: true })).toMatchObject({ titles: 1, skipped: [] });
    expect(await stored()).toEqual([2020]);
  });
});
