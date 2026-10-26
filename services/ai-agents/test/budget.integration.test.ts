/**
 * Orçamento diário de tokens compartilhado por TODOS os agentes (#60). O ledger `ops.llm_usage` já está
 * no limite (consumido por outro agente): cenário, resumo, curador e priorização ao vivo não chamam o
 * provedor e caem, de forma determinística, no texto/algoritmo de reserva. O onde assistir (execução
 * `skipped`) é coberto em `wtw-runner.integration.test.ts`.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { llmUsage, participant, type Database } from '@galaxie/db';
import { loadKnowledge } from '@galaxie/knowledge';
import { loadLlmClient } from '../src/cli/common.js';
import { runScenarioAgent } from '../src/context/run.js';
import { readEventContext } from '../src/context/store.js';
import { runCurator } from '../src/curator/run.js';
import { BudgetedLlmClient, dayUtcOf, PgTokenBudgetStore } from '../src/llm/budget.js';
import { createLlmClient, withTokenBudget } from '../src/llm/factory.js';
import { basePriority, prioritizeLive, type PriorityRequest } from '../src/priority/prioritize.js';
import { runRecapAgent } from '../src/recap/run.js';
import { FakeLlmClient } from '../src/testing/fake-llm.js';
import { detailFixture, disposableDb, idOf, ingest, seedCatalog, syntheticFixture } from './helpers.js';

const env = disposableDb();
let db: Database;
let secondLeg: string;
let finished: string;
const LIMIT = 50_000;
const LIB = { id: 13, name: 'CONMEBOL Libertadores', country: 'World', season: 2026 };
const SERIE_A = { id: 71, name: 'Serie A', country: 'Brazil', season: 2026 };
const PAL = { id: 121, name: 'Palmeiras' };
const COR = { id: 131, name: 'Corinthians' };

/** Provedor falso que registraria qualquer chamada (nenhuma deve chegar até ele). */
const fake = new FakeLlmClient(() => {
  throw new Error('o provedor não deveria ser chamado com o orçamento esgotado');
});
let llm: BudgetedLlmClient;

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
    { slug: 'brasileirao-serie-a', name: 'Serie A', leagueId: 71, tier: 1, type: 'league', country: 'BR' },
  ]);
  await ingest(
    db,
    [
      // quartas da Libertadores: ida encerrada, volta agendada (cenário)
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
      // clube fora da base semântica (lacuna do curador)
      syntheticFixture({
        id: 9201,
        league: { ...SERIE_A, round: 'Regular Season - 31' },
        date: '2026-10-25T19:00:00Z',
        home: PAL,
        away: { id: 99901, name: 'Exemplo FC' },
        status: 'NS',
      }),
    ],
    new Date('2026-10-22T02:00:00Z'),
  );
  // jogo real encerrado com timeline (resumo)
  await ingest(db, [detailFixture()], new Date('2026-10-11T22:25:00Z'));
  secondLeg = await idOf(db, 'event', 9002);
  finished = await idOf(db, 'event', 1492407);
  await db
    .update(participant)
    .set({ countryCode: 'BR' })
    .where(eq(participant.id, await idOf(db, 'participant', 99901)));

  // outro agente (onde assistir) já gastou todo o orçamento global do dia
  await db.insert(llmUsage).values({
    dayUtc: dayUtcOf(new Date()),
    agent: 'wtw',
    purpose: 'wtw:evento:BR',
    provider: 'openai',
    model: 'gpt-6.1-sol',
    tier: 'research',
    inputTokens: LIMIT - 1_000,
    outputTokens: 1_000,
    webSearches: 3,
    outcome: 'ok',
  });
  llm = withTokenBudget(fake, { db, dailyLimit: LIMIT });
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

describe('orçamento diário esgotado → todos os agentes caem no determinístico', () => {
  it('a fábrica dos agentes usa o ledger compartilhado ops.llm_usage', async () => {
    const runtime = createLlmClient({
      env: { OPENAI_API_KEY: 'sk-teste', AI_DAILY_TOKEN_BUDGET: String(LIMIT) },
      db,
    });
    expect(runtime.budget.store).toBeInstanceOf(PgTokenBudgetStore);
    expect(await runtime.budget.status()).toMatchObject({ used: LIMIT, limit: LIMIT, remaining: 0 });
    // as CLIs (cenário, resumo, curador) montam o cliente pela mesma fábrica, com o banco
    expect(loadLlmClient(db, { OPENAI_API_KEY: 'sk-teste' }).client).toBeInstanceOf(BudgetedLlmClient);
    expect(loadLlmClient(db, {}).client).toBeNull(); // sem chave: só determinístico
  });

  it('cenário: 8 locales com o texto dos rótulos do regulamento, sem chamar o provedor', async () => {
    const report = await runScenarioAgent(db, {
      now: new Date('2026-10-27T12:00:00Z'),
      llm,
      eventId: secondLeg,
    });
    expect(report.items[0]).toMatchObject({ action: 'generated', origins: { llm: 0, fallback: 8 } });
    expect(fake.calls).toBe(0);
    const rows = await readEventContext(db, secondLeg, { kinds: ['scenario'] });
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.content.origin === 'fallback' && r.content.fallbackReason === 'budget')).toBe(
      true,
    );
    expect(rows.every((r) => r.model === 'template:scenario-rules-labels@v1')).toBe(true);
    expect(rows.find((r) => r.locale === 'pt-BR')!.content.run.errors.join(' ')).toContain(
      'Orçamento diário de tokens esgotado',
    );
  });

  it('cenário: recusado pelo orçamento, não regrava nem republica na rodada seguinte do mesmo dia', async () => {
    const count = async () =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from enrich.event_context where event_id = ${secondLeg} and kind = 'scenario'`,
        )
      )[0]!.n;
    const feed = async () =>
      (await db.execute<{ n: number }>(sql`select count(*)::int as n from ops.change_feed`))[0]!.n;
    const before = { rows: await count(), feed: await feed() };
    // `now` no mesmo dia de orçamento em que a linha foi gravada (generatedAt é a hora real da gravação)
    const again = await runScenarioAgent(db, { now: new Date(), llm, eventId: secondLeg });
    expect(again.items[0]).toMatchObject({
      action: 'skipped',
      reason: 'fatos inalterados desde a última geração',
    });
    expect({ rows: await count(), feed: await feed() }).toEqual(before);

    // o operador abriu espaço no meio do dia (outro teto, sem o de tokens esgotado): tenta de novo agora
    const roomy = new FakeLlmClient(() => ({ texts: [] }));
    const withRoom = withTokenBudget(roomy, { dailyLimit: null }); // ledger em memória: não suja o teste do ledger abaixo
    expect(await withRoom.hasRoom('context', { slug: 'conmebol-libertadores' })).toBe(true);
    expect(
      await llm.hasRoom('context', { slug: 'conmebol-libertadores' }, { unit: 'tokens', requested: 1 }),
    ).toBe(false);
    const retried = await runScenarioAgent(db, { now: new Date(), llm: withRoom, eventId: secondLeg });
    expect(retried.items[0]!.action).toBe('generated');
    expect(roomy.calls).toBeGreaterThan(0);
    expect(await count()).toBeGreaterThan(before.rows);
  });

  it('resumo: texto montado da timeline, sem chamar o provedor', async () => {
    const report = await runRecapAgent(db, {
      now: new Date('2026-10-12T00:00:00Z'),
      llm,
      eventId: finished,
      locales: ['pt-BR', 'es-AR'],
    });
    expect(report.items[0]).toMatchObject({ action: 'generated', origins: { llm: 0, fallback: 2 } });
    expect(fake.calls).toBe(0);
    const [pt] = await readEventContext(db, finished, { kinds: ['recap'], locales: ['pt-BR'] });
    expect(pt!.model).toBe('template:recap-timeline@v1');
    expect(pt!.content.text).toMatch(/^Fim de jogo: Palmeiras 4 x 1 Corinthians\./);
  });

  it('curador: lacunas detectadas pelo código; pesquisa recusada sem gastar tokens', async () => {
    const result = await runCurator(db, await loadKnowledge(), {
      llm,
      now: new Date('2026-10-21T12:00:00Z'),
    });
    expect(result.gaps.map((g) => g.kind)).toContain('missing_team');
    expect(fake.calls).toBe(0);
    const proposal = result.proposals.find((p) => p.kind === 'add_team')!;
    expect(proposal.status).toBe('rejected');
    expect(proposal.reasons.join(' ')).toContain('Orçamento diário de tokens esgotado');
    expect(result.changes.files.size).toBe(0);
  });

  it('priorização ao vivo: algoritmo base, idêntico ao sem LLM', async () => {
    const c = (eventId: string, tier: number, importance: number, cost: number) => ({
      eventId,
      label: eventId,
      competition: 'x',
      tier,
      importance,
      startsAt: '2026-10-21T22:00:00Z',
      cost,
      markets: ['BR'],
    });
    const req: PriorityRequest = {
      candidates: [c('a', 2, 50, 20), c('b', 1, 44, 25), c('c', 1, 48, 25), c('d', 3, 20, 5)],
      budget: 50,
      activeMarkets: ['BR'],
      now: new Date('2026-10-21T12:00:00Z'),
    };
    const decision = await prioritizeLive(req, llm);
    expect(fake.calls).toBe(0);
    expect(decision.source).toBe('base');
    expect(decision.selected).toEqual(basePriority(req).selected);
    expect(decision.spent).toBeLessThanOrEqual(req.budget);
  });

  it('nenhuma chamada nova entrou no ledger', async () => {
    const rows = await db.select().from(llmUsage);
    expect(rows).toHaveLength(1);
  });
});
