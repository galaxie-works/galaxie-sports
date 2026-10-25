/** Motor de qualidade (job `data-quality`): as regras de SQL num banco descartável, a gravação e a retenção. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  broadcaster,
  competition,
  country,
  event,
  eventParticipant,
  participant,
  person,
  planChannel,
  platform,
  platformPlan,
  providerMap,
  qualityFailure,
  qualityResult,
  qualityRule,
  qualityRun,
  roster,
  season,
  sport,
  type Database,
} from '@galaxie/db';
import { F1DB_TABLES } from '@galaxie/providers';
import { storeF1dbRelease } from '../src/f1db/package-raw.js';
import { createQualityContext } from '../src/quality/context.js';
import {
  OUT_OF_SCOPE,
  pruneQuality,
  runRules,
  saveRun,
  selectRules,
  splitBySport,
  type RuleResultRow,
} from '../src/quality/engine.js';
import { QUALITY_RULES } from '../src/quality/rules/index.js';
import type { QualityRule, RuleOutcome } from '../src/quality/types.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
const NOW = new Date('2026-10-24T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const DAY = 86_400_000;

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values([
    { slug: 'football', name: { 'pt-BR': 'Futebol' } },
    { slug: 'hockey', name: { 'pt-BR': 'Hóquei' } },
  ]);
  await db
    .insert(country)
    .values({ code: 'GB', name: { en: 'Wales', 'pt-BR': 'País de Gales', es: 'Reino Unido' } });
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'serie-a', name: 'Serie A', type: 'league', tier: 1 })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: comp!.id, label: '2026', year: 2026, current: true })
    .returning();
  const [home, away, puck1, puck2] = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Sem Escudo FC' },
      { sport: 'football', kind: 'club', name: 'Com Escudo FC' },
      { sport: 'hockey', kind: 'club', name: 'Puck A' },
      { sport: 'hockey', kind: 'club', name: 'Puck B' },
    ])
    .returning();
  // escudo só no segundo time
  const [logo] = await db
    .insert(asset)
    .values({ kind: 'team_logo', sourceUrl: 'https://exemplo/logo.png' })
    .returning();
  await db.update(participant).set({ logoAssetId: logo!.id }).where(eq(participant.id, away!.id));

  const game = async (sp: string, a: string, b: string, values: Partial<typeof event.$inferInsert>) => {
    const [e] = await db
      .insert(event)
      .values({
        sport: sp,
        startsAt: hoursAgo(30),
        endsAtExpected: hoursAgo(28),
        ...(sp === 'football' ? { competitionId: comp!.id, seasonId: s!.id } : {}),
        ...values,
      })
      .returning();
    await db.insert(eventParticipant).values([
      { eventId: e!.id, participantId: a, side: 'home' },
      { eventId: e!.id, participantId: b, side: 'away' },
    ]);
    return e!.id;
  };
  await game('football', home!.id, away!.id, { status: 'finished', score: { home: 2, away: 1 } });
  await game('football', away!.id, home!.id, { status: 'finished', score: { home: null, away: null } });
  await game('football', home!.id, away!.id, { status: 'live' }); // fim previsto há 28 h: travado
  await game('football', home!.id, away!.id, {
    status: 'live',
    startsAt: hoursAgo(1),
    endsAtExpected: new Date(NOW.getTime() + 3_600_000),
  });
  await game('hockey', puck1!.id, puck2!.id, { status: 'finished' });

  const [old, young] = await db
    .insert(person)
    .values([
      { name: 'Veterano', birthDate: '1950-01-01' },
      { name: 'Jovem', birthDate: '2001-05-05' },
    ])
    .returning();
  await db.insert(roster).values([
    { participantId: home!.id, personId: old!.id, role: 'player' },
    { participantId: home!.id, personId: young!.id, role: 'player' },
    { participantId: away!.id, personId: old!.id, role: 'coach' },
  ]);
});

afterAll(async () => {
  await disposable.teardown();
});

const SQL_RULES = selectRules(QUALITY_RULES, {
  only: [
    'geo.ambiguous-country-code',
    'events.',
    'assets.tier1-team-logo',
    'people.plausible-birth-date',
    'f1.season-team',
  ],
});

describe('regras de SQL', () => {
  it('acham os erros semeados, por esporte', async () => {
    const rows = await runRules(SQL_RULES, createQualityContext(db, { env: {}, now: NOW }));
    const by = (id: string, sport: string) => rows.find((r) => r.ruleId === id && r.sport === sport);
    expect(by('geo.ambiguous-country-code', 'geo')).toMatchObject({ status: 'fail', checked: 1, failed: 1 });
    expect(by('geo.ambiguous-country-code', 'geo')!.failures[0]).toMatchObject({
      key: 'GB',
      current: 'en: Wales · pt-BR: País de Gales',
    });
    expect(by('events.finished-has-score', 'football')).toMatchObject({
      status: 'fail',
      checked: 2,
      failed: 1,
    });
    expect(by('events.finished-has-score', 'hockey')).toMatchObject({
      status: 'fail',
      checked: 1,
      failed: 1,
    });
    expect(by('events.finished-has-score', 'football')!.failures[0]).toMatchObject({
      label: 'Com Escudo FC × Sem Escudo FC · 2026-10-23',
      link: { type: 'event' },
    });
    expect(by('events.no-stale-live', 'football')).toMatchObject({ status: 'fail', failed: 1 });
    expect(by('assets.tier1-team-logo', 'football')).toMatchObject({ status: 'fail', checked: 2, failed: 1 });
    expect(by('assets.tier1-team-logo', 'football')!.failures[0]!.label).toBe('Sem Escudo FC · Serie A');
    // o técnico com 76 anos não conta; o jogador sim
    expect(by('people.plausible-birth-date', 'football')).toMatchObject({
      status: 'fail',
      checked: 2,
      failed: 1,
    });
    // sem API configurada, a regra da F1 é pulada, não aprovada
    expect(by('f1.season-team', 'formula-1')).toMatchObject({ status: 'skipped' });
  });
});

describe('regras de grade', () => {
  it('só conferem planos vigentes no dia (o expirado e o futuro não são servidos)', async () => {
    await db
      .insert(broadcaster)
      .values({ id: 'canal-teste', name: 'Canal Teste', kind: 'pay_tv', markets: {} });
    const [pf] = await db
      .insert(platform)
      .values({
        slug: 'br-operadora-teste',
        name: 'Operadora Teste',
        kind: 'pay_tv_operator',
        country: 'BR',
        website: 'https://operadora.exemplo.com.br',
        reviewStatus: 'approved',
      })
      .returning();
    const plans = await db
      .insert(platformPlan)
      .values(
        [
          { slug: 'vigente', validFrom: '2026-01-01' },
          { slug: 'expirado', validTo: '2026-09-30' },
          { slug: 'futuro', validFrom: '2026-11-01' },
        ].map((p) => ({
          ...p,
          platformId: pf!.id,
          name: p.slug,
          country: 'BR',
          reviewStatus: 'approved' as const,
        })),
      )
      .returning();
    // sem fonte e sem preço: os três falhariam se fossem conferidos
    await db.insert(planChannel).values(
      plans.map((p) => ({
        planId: p.id,
        channelId: 'canal-teste',
        access: 'included' as const,
        reviewStatus: 'approved' as const,
      })),
    );

    const rows = await runRules(
      selectRules(QUALITY_RULES, {
        only: ['watch.included-has-official-source', 'watch.plan-price-currency'],
      }),
      createQualityContext(db, { env: {}, now: NOW }),
    );
    const vigente = plans.find((p) => p.slug === 'vigente')!.id;
    for (const r of rows) {
      expect(r).toMatchObject({ status: 'fail', checked: 1, failed: 1 });
      expect(r.failures[0]!.key.startsWith(vigente)).toBe(true);
    }
    expect(rows).toHaveLength(2);
  });
});

describe('vínculo dos pilotos prioritários da F1', () => {
  const rule = selectRules(QUALITY_RULES, { only: ['f1.driver-link'] });
  const run = async () => (await runRules(rule, createQualityContext(db, { env: {}, now: NOW })))[0]!;

  it('lê a prioridade do F1DB importado no raw (sem baixar o release) e acusa quem não tem vínculo', async () => {
    // sem F1DB no raw: skipped com o motivo, nunca pass (e nada de download)
    expect(await run()).toMatchObject({
      status: 'skipped',
      detail: 'F1DB não importado no core (rode f1db:import)',
    });

    const dir = mkdtempSync(join(tmpdir(), 'f1db-quality-'));
    const path = join(dir, 'f1db.db');
    const sqlite = new DatabaseSync(path);
    const columns: Record<string, string> = {
      driver: 'id TEXT, name TEXT, total_race_starts INTEGER, total_race_wins INTEGER',
      race: 'id INTEGER, year INTEGER, date TEXT',
      season_driver: 'year INTEGER, driver_id TEXT, total_race_starts INTEGER',
      season_driver_standing: 'year INTEGER, driver_id TEXT, position_number INTEGER',
    };
    // `constructor` também é propriedade de todo objeto: só a própria vale
    for (const table of F1DB_TABLES)
      sqlite.exec(`CREATE TABLE "${table}" (${Object.hasOwn(columns, table) ? columns[table] : 'id TEXT'})`);
    const driver = sqlite.prepare('INSERT INTO driver VALUES (?, ?, ?, ?)');
    // 21 veteranos: o de menos GPs e vitórias fica fora dos dois top 20
    for (let i = 0; i < 21; i++) driver.run(`veterano-${i}`, `Veterano ${i}`, 100 + i, 10 + i);
    driver.run('novato', 'Novato', 1, 0);
    driver.run('campeao-antigo', 'Campeão Antigo', 2, 0);
    driver.run('lider-2026', 'Líder 2026', 3, 0);
    driver.run('reserva', 'Reserva', 0, 0);
    const race = sqlite.prepare('INSERT INTO race VALUES (?, ?, ?)');
    race.run(1, 1950, '1950-05-13');
    race.run(2, 2026, '2026-10-01');
    race.run(3, 2026, '2026-12-06'); // ainda falta corrida: a liderança de 2026 não é título
    sqlite.prepare('INSERT INTO season_driver VALUES (?, ?, ?)').run(2026, 'lider-2026', 1);
    const standing = sqlite.prepare('INSERT INTO season_driver_standing VALUES (?, ?, ?)');
    standing.run(1950, 'campeao-antigo', 1);
    standing.run(2026, 'lider-2026', 1);
    sqlite.close();
    try {
      await storeF1dbRelease(db, path, 'v-qualidade');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // raw sem vínculo nenhum no core: F1DB não normalizado, skipped (não ~70 falhas)
    expect(await run()).toMatchObject({ status: 'skipped' });
    expect((await run()).detail).toContain('nenhum piloto com vínculo f1db (release v-qualidade no raw)');

    const linked = [...Array.from({ length: 21 }, (_, i) => `veterano-${i}`), 'novato'];
    await db.insert(providerMap).values(
      linked.map((id) => ({
        entityType: 'participant',
        entityId: randomUUID(),
        provider: 'f1db',
        sport: 'formula-1',
        providerId: `driver-${id}`,
      })),
    );
    const row = await run();
    // 20 veteranos + o campeão + o líder do grid; o novato, o 21º veterano e o reserva não são prioritários
    expect(row).toMatchObject({ status: 'fail', checked: 22, failed: 2 });
    expect(row.failures.map((f) => [f.key, f.label])).toEqual([
      ['campeao-antigo', 'Campeão Antigo · campeão'],
      ['lider-2026', 'Líder 2026 · grid 2026'],
    ]);
  });
});

describe('gravação', () => {
  it('grava o catálogo e o placar, mantém o "desde" de uma falha que continua e apaga o que passou da retenção', async () => {
    const first = await runRules(SQL_RULES, createQualityContext(db, { env: {}, now: NOW }));
    const run1 = await saveRun(db, QUALITY_RULES, first, { trigger: 'cli', startedAt: NOW, finishedAt: NOW });

    // a falha do país some na segunda execução; a do placar continua
    await db
      .update(country)
      .set({ name: { en: 'United Kingdom', 'pt-BR': 'Reino Unido', es: 'Reino Unido' } });
    const later = new Date(NOW.getTime() + DAY);
    const second = await runRules(SQL_RULES, createQualityContext(db, { env: {}, now: later }));
    const run2 = await saveRun(db, QUALITY_RULES, second, {
      trigger: 'schedule',
      startedAt: later,
      finishedAt: later,
    });

    expect((await db.select().from(qualityRule)).length).toBe(QUALITY_RULES.length);
    const results = await db.select().from(qualityResult).where(eq(qualityResult.runId, run2));
    expect(results.find((r) => r.ruleId === 'geo.ambiguous-country-code')).toMatchObject({
      status: 'pass',
      failed: 0,
    });
    const failures = await db.select().from(qualityFailure).where(eq(qualityFailure.runId, run2));
    const score = failures.find((f) => f.ruleId === 'events.finished-has-score' && f.sport === 'football')!;
    expect(score.firstSeenAt.toISOString()).toBe(NOW.toISOString());
    expect(failures.some((f) => f.ruleId === 'geo.ambiguous-country-code')).toBe(false);
    const runs = await db.select().from(qualityRun).orderBy(asc(qualityRun.startedAt));
    expect(runs.map((r) => [r.id, r.trigger, r.status])).toEqual([
      [run1, 'cli', 'done'],
      [run2, 'schedule', 'done'],
    ]);

    // 31 dias depois: as falhas da primeira execução saem, o placar fica
    expect((await pruneQuality(db, new Date(NOW.getTime() + 31 * DAY))).runs).toBe(0);
    expect(await db.select().from(qualityFailure).where(eq(qualityFailure.runId, run1))).toEqual([]);
    expect(
      (await db.select().from(qualityResult).where(eq(qualityResult.runId, run1))).length,
    ).toBeGreaterThan(0);
    // 181 dias depois: a execução inteira sai
    expect((await pruneQuality(db, new Date(NOW.getTime() + 181 * DAY))).runs).toBe(1);
  });
});

describe('gravação entre execuções parciais', () => {
  const fake = (id: string, sport: string): QualityRule => ({
    id,
    sport,
    area: 'events',
    severity: 'high',
    description: { 'pt-BR': id, en: id, es: id },
    check: async () => ({ checked: 0, failures: [] }),
  });
  const ruleA = fake('teste.a', 'football');
  const ruleB = fake('teste.b', 'football');
  const ruleAll = fake('teste.all', 'all');
  const at = (days: number) => new Date(NOW.getTime() + (200 + days) * DAY);
  const save = (rows: RuleResultRow[], when: Date) =>
    saveRun(db, [ruleA, ruleB, ruleAll], rows, { trigger: 'cli', startedAt: when, finishedAt: when });
  const rowsOf = (rule: QualityRule, outcome: RuleOutcome) => splitBySport(rule, outcome, 0);
  const errorRow = (rule: QualityRule): RuleResultRow => ({
    ruleId: rule.id,
    sport: rule.sport,
    severity: rule.severity,
    status: 'error',
    checked: 0,
    failed: 0,
    detail: 'quebrou',
    durationMs: 0,
    failures: [],
  });
  const failing = { checked: 3, failures: [{ key: 'k1', label: 'K1' }] };
  const firstSeen = async (runId: string, ruleId: string) =>
    (await db.select().from(qualityFailure).where(eq(qualityFailure.runId, runId))).find(
      (f) => f.ruleId === ruleId,
    )?.firstSeenAt;

  it('o "desde" sobrevive a uma execução gravada só com outras regras e a um error no meio', async () => {
    await save([...rowsOf(ruleA, failing), ...rowsOf(ruleB, { checked: 1, failures: [] })], at(0));
    // execução filtrada (--regras teste.b): não tem a regra A
    await save(rowsOf(ruleB, { checked: 1, failures: [] }), at(1));
    // a regra A quebrou: não diz que a falha sumiu
    await save([errorRow(ruleA)], at(2));
    const run = await save(rowsOf(ruleA, failing), at(3));
    expect((await firstSeen(run, 'teste.a'))!.toISOString()).toBe(at(0).toISOString());

    // a falha some (pass) e volta: o "desde" recomeça
    await save(rowsOf(ruleA, { checked: 3, failures: [] }), at(4));
    const back = await save(rowsOf(ruleA, failing), at(5));
    expect((await firstSeen(back, 'teste.a'))!.toISOString()).toBe(at(5).toISOString());
  });

  it('esporte que saiu do escopo de uma regra "all" sai como skipped (uma vez), não a falha antiga para sempre', async () => {
    const both = {
      checked: { football: 2, hockey: 1 },
      failures: [
        { key: 'f', label: 'F', sport: 'football' },
        { key: 'h', label: 'H', sport: 'hockey' },
      ],
    };
    const onlyFootball = {
      checked: { football: 2 },
      failures: [{ key: 'f', label: 'F', sport: 'football' }],
    };
    const resultsOf = async (runId: string) =>
      (await db.select().from(qualityResult).where(eq(qualityResult.runId, runId)))
        .filter((r) => r.ruleId === 'teste.all')
        .map((r) => [r.sport, r.status, r.checked, r.failed, r.detail])
        .sort();

    await save(rowsOf(ruleAll, both), at(10));
    // a regra quebrou: nada de skipped por esporte (não se sabe se o hóquei saiu)
    expect(await resultsOf(await save([errorRow(ruleAll)], at(11)))).toEqual([
      ['all', 'error', 0, 0, 'quebrou'],
    ]);
    // volta a rodar sem o hóquei: skipped com o motivo (nunca pass), e nada de linha "all" inventada
    expect(await resultsOf(await save(rowsOf(ruleAll, onlyFootball), at(12)))).toEqual([
      ['football', 'fail', 2, 1, null],
      ['hockey', 'skipped', 0, 0, OUT_OF_SCOPE],
    ]);
    // o skipped já gravado não se repete
    expect(await resultsOf(await save(rowsOf(ruleAll, onlyFootball), at(13)))).toEqual([
      ['football', 'fail', 2, 1, null],
    ]);
    // o hóquei volta com a mesma falha: o skipped no meio não zerou o "desde"
    const back = await save(rowsOf(ruleAll, both), at(14));
    const hockey = (await db.select().from(qualityFailure).where(eq(qualityFailure.runId, back))).find(
      (f) => f.ruleId === 'teste.all' && f.sport === 'hockey',
    )!;
    expect(hockey.firstSeenAt.toISOString()).toBe(at(10).toISOString());
  });
});
