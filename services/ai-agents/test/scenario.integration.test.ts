import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeFeed, eventContext, season, standing, type Database } from '@galaxie/db';
import { readEventContext, type StoredContextContent } from '../src/context/store.js';
import { runScenarioAgent } from '../src/context/run.js';
import { AGENT_LOCALES } from '../src/guardrails/index.js';
import { FakeLlmClient } from '../src/testing/fake-llm.js';
import { GOOD_SCENARIO, llmTexts, requestedLocales } from '../src/testing/samples.js';
import { disposableDb, idOf, ingest, seedCatalog, syntheticFixture } from './helpers.js';

const env = disposableDb();
let db: Database;
let secondLeg: string;
let groupMatch: string;

const LIB = { id: 13, name: 'CONMEBOL Libertadores', country: 'World', season: 2026 };
const PAL = { id: 121, name: 'Palmeiras' };
const COR = { id: 131, name: 'Corinthians' };
const NOW = new Date('2026-10-27T12:00:00Z');

beforeAll(async () => {
  db = await env.setup();
  await seedCatalog(db, [
    {
      slug: 'conmebol-libertadores',
      name: 'CONMEBOL Libertadores',
      leagueId: 13,
      tier: 1,
      type: 'cup',
      country: 'WORLD',
    },
  ]);
  // quartas de final: ida Corinthians 1 × 2 Palmeiras (encerrada), volta no Palmeiras (agendada)
  await ingest(
    db,
    [
      syntheticFixture({
        id: 9001,
        league: { ...LIB, round: 'Quarter-finals' },
        date: '2026-10-21T23:30:00Z',
        home: COR,
        away: PAL,
        status: 'FT',
        goals: { home: 1, away: 2 },
      }),
      syntheticFixture({
        id: 9002,
        league: { ...LIB, round: 'Quarter-finals' },
        date: '2026-10-28T23:30:00Z',
        home: PAL,
        away: COR,
        status: 'NS',
      }),
      // fase de grupos, última rodada (dois jogos)
      syntheticFixture({
        id: 9101,
        league: { ...LIB, round: 'Group A - 6' },
        date: '2026-10-29T22:00:00Z',
        home: PAL,
        away: COR,
        status: 'NS',
      }),
      syntheticFixture({
        id: 9102,
        league: { ...LIB, round: 'Group A - 6' },
        date: '2026-10-29T22:00:00Z',
        home: { id: 7001, name: 'Time Três' },
        away: { id: 7002, name: 'Time Quatro' },
        status: 'NS',
      }),
    ],
    new Date('2026-10-22T02:00:00Z'),
  );
  secondLeg = await idOf(db, 'event', 9002);
  groupMatch = await idOf(db, 'event', 9101);
  const [s] = await db.select().from(season).where(eq(season.year, 2026));
  const table: [number, number, number][] = [
    [121, 12, 5],
    [131, 9, 5],
    [7001, 3, 5],
    [7002, 3, 5],
  ];
  let rank = 1;
  for (const [team, points, played] of table) {
    await db.insert(standing).values({
      seasonId: s!.id,
      group: 'Group A',
      participantId: await idOf(db, 'participant', team),
      rank: rank++,
      points,
      played,
    });
  }
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

async function rows(eventId: string) {
  return db
    .select()
    .from(eventContext)
    .where(and(eq(eventContext.eventId, eventId), eq(eventContext.kind, 'scenario')))
    .orderBy(asc(eventContext.createdAt), asc(eventContext.locale));
}

describe('Agente Cenário (integração)', () => {
  it('--plan lista o que seria gerado sem chamar LLM nem gravar', async () => {
    const report = await runScenarioAgent(db, { now: NOW, llm: null, plan: true });
    const byEvent = Object.fromEntries(report.items.map((i) => [i.eventId, i]));
    expect(byEvent[secondLeg]).toMatchObject({
      action: 'planned',
      summary: 'home:advances_with_draw, away:needs_win_by_2, away:win_by_1_goes_to_penalties',
    });
    expect(byEvent[groupMatch]!.action).toBe('planned');
    expect(await rows(secondLeg)).toHaveLength(0);
  });

  it('gera o cenário nos 8 locales com o LLM, grava fontes e publica no change feed', async () => {
    const llm = new FakeLlmClient(
      (req) => llmTexts(GOOD_SCENARIO, requestedLocales(req.messages[0]!.content)),
      {
        model: 'fake-standard-1',
      },
    );
    const report = await runScenarioAgent(db, { now: NOW, llm, eventId: secondLeg });
    expect(report.items[0]).toMatchObject({
      action: 'generated',
      origins: { llm: 8, fallback: 0 },
      llmCalls: 1,
    });
    const stored = await rows(secondLeg);
    expect(stored.map((r) => r.locale).sort()).toEqual([...AGENT_LOCALES].sort());
    const pt = stored.find((r) => r.locale === 'pt-BR')!;
    const content = pt.content as StoredContextContent;
    expect(content.text).toBe(GOOD_SCENARIO['pt-BR'].join(' '));
    expect(content).toMatchObject({ origin: 'llm', attempts: 1, fits: { tv: true } });
    expect((content.data['stakes'] as { code: string }[]).map((s) => s.code)).toContain('needs_win_by_2');
    expect(pt).toMatchObject({ model: 'fake-standard-1', confidence: '0.90', reviewStatus: 'auto' });
    expect(pt.sources).toEqual(
      expect.arrayContaining([
        { kind: 'core', ref: `core.event:${secondLeg}` },
        { kind: 'rules', ref: 'config/rules/conmebol-libertadores.yaml' },
      ]),
    );
    const feed = await db.select().from(changeFeed).where(eq(changeFeed.topic, 'event.context_published'));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ entityType: 'event_context', entityId: secondLeg });
    expect((feed[0]!.payload as { tags: string[] }).tags).toContain(`event_context:${secondLeg}`);
  });

  it('não regenera quando os fatos não mudaram', async () => {
    const llm = new FakeLlmClient([new Error('não deveria ser chamado')]);
    const report = await runScenarioAgent(db, { now: NOW, llm, eventId: secondLeg });
    expect(report.items[0]).toMatchObject({
      action: 'skipped',
      reason: 'fatos inalterados desde a última geração',
    });
    expect(llm.calls).toBe(0);
  });

  it('saída adversarial do LLM nunca é publicada: retry e fallback determinístico', async () => {
    const bad = {
      ...GOOD_SCENARIO,
      'pt-BR': ['O Corinthians precisa vencer por 3 a 0 para avançar.'],
      'es-CL': ['El Verdão avanza con el empate.'],
    };
    const llm = new FakeLlmClient((req) => llmTexts(bad, requestedLocales(req.messages[0]!.content)));
    const report = await runScenarioAgent(db, { now: NOW, llm, eventId: secondLeg, force: true });
    expect(report.items[0]).toMatchObject({
      action: 'generated',
      origins: { llm: 6, fallback: 2 },
      llmCalls: 2,
    });
    const latest = await readEventContext(db, secondLeg, { kinds: ['scenario'] });
    const pt = latest.find((r) => r.locale === 'pt-BR')!;
    expect(pt.model).toBe('template:scenario-rules-labels@v1');
    expect(pt.confidence).toBe(1);
    expect(pt.content.text).toBe(
      'Jogo de ida: Corinthians 1 x 2 Palmeiras. Palmeiras: avança com empate. ' +
        'Corinthians: precisa vencer por 2 gols para avançar direto; vitória por 1 gol leva a decisão aos pênaltis.',
    );
    expect(pt.content.rejected.flatMap((r) => r.violations.map((v) => v.kind))).toEqual(
      expect.arrayContaining(['unknown_score']),
    );
    expect(latest.find((r) => r.locale === 'es-CL')!.content.origin).toBe('fallback');
    expect(latest.find((r) => r.locale === 'es-AR')!.content.origin).toBe('llm');
  });

  it('fase de grupos: stakes da tabela e texto determinístico sem LLM', async () => {
    const report = await runScenarioAgent(db, {
      now: NOW,
      llm: null,
      eventId: groupMatch,
      locales: ['pt-BR', 'es-MX'],
    });
    expect(report.items[0]!.action).toBe('generated');
    expect(report.items[0]!.summary).toContain('qualifies_for_round_of_16');
    const latest = await readEventContext(db, groupMatch);
    expect(latest.map((r) => r.locale)).toEqual(['es-MX', 'pt-BR']);
    expect(latest.find((r) => r.locale === 'pt-BR')!.content.text).toContain(
      'Palmeiras: garante ao menos as oitavas de final',
    );
    expect(latest.every((r) => r.content.fallbackReason === 'no_llm')).toBe(true);
  });

  it('jogo encerrado ou sem regra não gera cenário', async () => {
    const firstLeg = await idOf(db, 'event', 9001);
    const report = await runScenarioAgent(db, { now: NOW, llm: null, eventId: firstLeg });
    expect(report.items[0]).toMatchObject({ action: 'skipped', reason: 'evento finished' });
  });
});
