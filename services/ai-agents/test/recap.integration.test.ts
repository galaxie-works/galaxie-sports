import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeFeed, eventContext, eventStateLog, type Database } from '@galaxie/db';
import { readEventContext } from '../src/context/store.js';
import { computeAiMetrics } from '../src/evaluation/metrics.js';
import { languageOf } from '../src/guardrails/index.js';
import { onEventFinished, runRecapAgent } from '../src/recap/run.js';
import { FakeLlmClient } from '../src/testing/fake-llm.js';
import { requestedLocales } from '../src/testing/samples.js';
import { detailFixture, disposableDb, idOf, ingest, seedCatalog } from './helpers.js';

const env = disposableDb();
let db: Database;
let eventId: string;
const NOW = new Date('2026-10-12T00:00:00Z');

const GOOD: Record<'pt' | 'es', string[]> = {
  pt: [
    'O Palmeiras venceu o Corinthians por 4 a 1 pela Rodada 30.',
    "Atacante A marcou duas vezes, aos 12' e aos 90+4', e Meia A converteu um pênalti aos 77'; Zagueiro B fez contra aos 45+2'.",
    "Reserva B descontou para o Corinthians aos 81'.",
  ],
  es: [
    'Palmeiras le ganó 4-1 a Corinthians en la Fecha 30.',
    'Atacante A marcó dos goles, a los 12 y en el 90+4, Meia A anotó de penal a los 77 y Zagueiro B convirtió en contra en el 45+2.',
    'Reserva B descontó a los 81.',
  ],
};

function responder(texts: Record<'pt' | 'es', string[]>) {
  return (req: { messages: { content: string }[] }) => ({
    texts: requestedLocales(req.messages[0]!.content).map((locale) => ({
      locale,
      sentences: texts[languageOf(locale)],
    })),
  });
}

beforeAll(async () => {
  db = await env.setup();
  await seedCatalog(db, [
    { slug: 'brasileirao-serie-a', name: 'Serie A', leagueId: 71, tier: 1, type: 'league', country: 'BR' },
  ]);
  await ingest(db, [detailFixture()], new Date('2026-10-11T22:25:00Z'));
  eventId = await idOf(db, 'event', 1492407);
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

describe('Agente Resumo (integração)', () => {
  it('encontra o jogo encerrado na janela e gera o resumo validado em 8 locales', async () => {
    const plan = await runRecapAgent(db, { now: NOW, llm: null, plan: true });
    expect(plan.items).toEqual([expect.objectContaining({ eventId, action: 'planned', summary: '4-1' })]);

    const llm = new FakeLlmClient(responder(GOOD));
    const report = await runRecapAgent(db, { now: NOW, llm });
    expect(report.items[0]).toMatchObject({ action: 'generated', origins: { llm: 8, fallback: 0 } });
    const latest = await readEventContext(db, eventId, { kinds: ['recap'] });
    expect(latest).toHaveLength(8);
    const pt = latest.find((r) => r.locale === 'pt-BR')!;
    expect(pt.content.text).toBe(GOOD.pt.join(' '));
    expect(pt.content.data['final_score']).toEqual({ home: 4, away: 1 });
    expect(pt.sources.map((s) => s.ref)).toContain(`core.event_incident:${eventId}`);
    // estatísticas e timeline foram para os fatos do LLM
    const facts = llm.requests[0]!.messages[0]!.content;
    expect(facts).toContain('"possession_pct":58');
    expect(facts).toContain('"type":"own_goal"');
  });

  it.each([
    [
      'autor inventado',
      ["Fim de jogo: Palmeiras 4 x 1 Corinthians. Endrick marcou aos 12'."],
      'unknown_name',
    ],
    ['placar errado', ['O Palmeiras venceu o Corinthians por 3 a 1.'], 'wrong_result'],
    [
      'termo ofensivo',
      ['Fim de jogo: Palmeiras 4 x 1 Corinthians, um massacre humilhante sobre os gambás.'],
      'forbidden_rivalry',
    ],
    ['minuto inventado', ["Palmeiras 4 x 1 Corinthians, com gol de Atacante A aos 33'."], 'unknown_minute'],
  ])('%s: rejeita, tenta de novo e publica o resumo determinístico', async (_label, sentences, kind) => {
    const llm = new FakeLlmClient(responder({ pt: sentences, es: sentences }));
    const report = await onEventFinished(db, eventId, llm, { force: true, locales: ['pt-BR'] });
    expect(llm.calls).toBe(2);
    expect(report.items[0]).toMatchObject({ action: 'generated', origins: { llm: 0, fallback: 1 } });
    const [pt] = await readEventContext(db, eventId, { kinds: ['recap'], locales: ['pt-BR'] });
    expect(pt!.model).toBe('template:recap-timeline@v1');
    expect(pt!.content.text).toBe(
      "Fim de jogo: Palmeiras 4 x 1 Corinthians. Gols do Palmeiras: Atacante A (12' e 90+4'), Zagueiro B (contra, 45+2') e Meia A (pênalti, 77'). " +
        "Gol do Corinthians: Reserva B (81'). Pênalti perdido: Atacante B (Corinthians, 58').",
    );
    expect(pt!.content.rejected.flatMap((r) => r.violations.map((v) => v.kind))).toContain(kind);
  });

  it('métricas de qualidade e custo (painel)', async () => {
    // FT registrado na ingestão (out/2026); o resumo foi gerado só agora: fora da meta de 10 min
    const [ft] = await db.select().from(eventStateLog).where(eq(eventStateLog.eventId, eventId));
    expect(ft).toMatchObject({ toStatus: 'finished' });
    const m = await computeAiMetrics(db, {
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date(Date.now() + 60_000),
    });
    expect(m.byKind.recap.texts).toBe(8 + 4);
    expect(m.byKind.recap.events).toBe(1);
    expect(m.byKind.recap.llmFirstPass).toMatchObject({ numerator: 8, denominator: 12 });
    expect(m.byKind.recap.fallback).toMatchObject({ numerator: 4, denominator: 12 });
    expect(m.byKind.recap.fallbackReasons).toEqual({ rejected: 4 });
    expect(Object.keys(m.byKind.recap.blockedViolations)).toEqual(
      expect.arrayContaining(['unknown_name', 'wrong_result', 'forbidden_rivalry', 'unknown_minute']),
    );
    expect(m.byKind.recap.fidelityValidator.value).toBe(1);
    expect(m.cost.llmCalls).toBe(1 + 4 * 2);
    expect(m.cost.costUsd).toBeCloseTo(0.002 * 9);
    expect(m.cost.costPerEventUsd).toBeCloseTo(0.018);
    expect(m.coverage.recapTier1Within10Min).toMatchObject({ numerator: 0, denominator: 1 });
    expect(m.coverage.recapTier1Within10Min.medianMinutes).toBeGreaterThan(10);
    expect(m.targets.find((t) => t.metric.startsWith('Resumo tier 1'))).toMatchObject({ ok: false });
    expect(m.targets.find((t) => t.metric.startsWith('Fidelidade do resumo'))).toMatchObject({ ok: true });
    const feed = await db.select().from(changeFeed).where(eq(changeFeed.entityId, eventId));
    expect(feed).toHaveLength(5);
    expect((await db.select().from(eventContext)).length).toBe(12);
  });
});
