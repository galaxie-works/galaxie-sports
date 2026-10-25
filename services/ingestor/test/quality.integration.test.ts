/** Motor de qualidade (job `data-quality`): as regras de SQL num banco descartável, a gravação e a retenção. */
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
  qualityFailure,
  qualityResult,
  qualityRule,
  qualityRun,
  roster,
  season,
  sport,
  type Database,
} from '@galaxie/db';
import { createQualityContext } from '../src/quality/context.js';
import { pruneQuality, runRules, saveRun, selectRules } from '../src/quality/engine.js';
import { QUALITY_RULES } from '../src/quality/rules/index.js';
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
    await db
      .insert(planChannel)
      .values(
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
