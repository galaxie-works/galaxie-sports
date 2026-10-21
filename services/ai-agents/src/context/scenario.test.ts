import { describe, expect, it } from 'vitest';
import { knockoutStageRules, knockoutStakes } from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { AGENT_LOCALES, checkGeneratedText, joinSentences, type AgentLocale } from '../guardrails/index.js';
import { FakeLlmClient } from '../testing/fake-llm.js';
import { GOOD_SCENARIO, llmTexts, requestedLocales, sampleCore } from '../testing/samples.js';
import {
  buildScenarioFacts,
  scenarioFactSheet,
  scenarioFallback,
  scenarioSystemPrompt,
  scenarioUserPrompt,
} from './scenario.js';
import type { EventStakes } from './stakes.js';
import { confidenceOf, writeLocalizedTexts, type LocalizedWriteRequest } from './writer.js';

const core = sampleCore();

async function sampleStakes(): Promise<EventStakes> {
  const rules = await loadCompetitionRules('conmebol-libertadores', { season: 2026 });
  const stage = knockoutStageRules(rules, 'quarter_final');
  // ida: Corinthians 1 × 2 Palmeiras (mandante da ida = visitante da volta)
  const firstLeg = { homeGoals: 1, awayGoals: 2 };
  return {
    stakes: knockoutStakes({ rules: stage, leg: 2, firstLeg }),
    rules,
    knockout: {
      legs: 2,
      leg: 2,
      firstLeg: { homeTeamId: core.away.id, awayTeamId: core.home.id, ...firstLeg },
      aggregateBefore: { home: 2, away: 1 },
      extraTime: stage.extraTime,
      penalties: stage.penalties,
      decidesTitle: stage.decidesTitle,
    },
  };
}

async function request(llm: FakeLlmClient | null): Promise<LocalizedWriteRequest> {
  const stakes = await sampleStakes();
  const facts = buildScenarioFacts(core, stakes, AGENT_LOCALES);
  return {
    locales: AGENT_LOCALES,
    system: scenarioSystemPrompt(),
    userPrompt: (ls) => scenarioUserPrompt(facts, ls),
    factsFor: (l) => scenarioFactSheet(core, facts, stakes.stakes, l),
    fallback: (l) => scenarioFallback(core, facts, stakes.stakes, l),
    surface: 'tv',
    minSentences: 1,
    maxSentences: 3,
    llm,
    purpose: 'teste',
  };
}

describe('cenário: stakes do exemplo de docs/07 §2.3', () => {
  it('motor de regras dá os três códigos esperados', async () => {
    const { stakes } = await sampleStakes();
    expect(stakes.map((s) => `${s.team}:${s.code}`)).toEqual([
      'home:advances_with_draw',
      'away:needs_win_by_2',
      'away:win_by_1_goes_to_penalties',
    ]);
  });

  it('fatos para o LLM trazem rótulos por locale e a ida, sem IDs internos', async () => {
    const stakes = await sampleStakes();
    const facts = buildScenarioFacts(core, stakes, AGENT_LOCALES);
    expect(facts.knockout?.first_leg).toEqual({
      home: 'Corinthians',
      away: 'Palmeiras',
      home_goals: 1,
      away_goals: 2,
    });
    expect(facts.stakes[0]!.labels['es-MX']).toBe('Avanza con el empate');
    expect(JSON.stringify(facts)).not.toContain('home-id');
  });

  it.each(AGENT_LOCALES)('fallback determinístico passa nos guardrails (%s)', async (locale: AgentLocale) => {
    const req = await request(null);
    const sentences = req.fallback(locale);
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(
      checkGeneratedText(joinSentences(sentences), { locale, facts: req.factsFor(locale), surface: 'tv' }),
    ).toEqual([]);
  });

  it('fallback pt-BR usa os rótulos fixos', async () => {
    const req = await request(null);
    expect(req.fallback('pt-BR')).toEqual([
      'Jogo de ida: Corinthians 1 x 2 Palmeiras',
      'Palmeiras: avança com empate',
      'Corinthians: precisa vencer por 2 gols para avançar direto; vitória por 1 gol leva a decisão aos pênaltis',
    ]);
  });
});

describe('writer: LLM + validador + retry + fallback', () => {
  it('texto fiel em todos os locales é aceito na 1ª tentativa', async () => {
    const llm = new FakeLlmClient([llmTexts(GOOD_SCENARIO)]);
    const res = await writeLocalizedTexts(await request(llm));
    expect(res.llmCalls).toBe(1);
    expect(res.texts.every((t) => t.origin === 'llm' && t.attempts === 1)).toBe(true);
    expect(res.texts.map((t) => confidenceOf(t))).toEqual(Array(8).fill(0.9));
    expect(llm.requests[0]!.tier).toBe('standard');
    expect(llm.requests[0]!.schemaName).toBe('localized_texts');
  });

  it('reprova saídas adversariais, tenta de novo só os locales reprovados e cai no fallback', async () => {
    const bad = {
      ...GOOD_SCENARIO,
      // margem inventada
      'pt-BR': ['O Corinthians precisa vencer por três gols para avançar.'],
      // apelido/nome fora dos fatos
      'es-MX': ['Las Chivas no juegan, pero el Verdão avanza con el empate.'],
      // termo ofensivo
      'es-AR': ['Corinthians necesita ganar por dos goles, son unos pelotudos.'],
    };
    const llm = new FakeLlmClient((req, call) => {
      if (call === 1) return llmTexts(bad);
      // 2ª tentativa: corrige pt-BR, insiste no erro em es-MX e es-AR
      return llmTexts(
        { ...bad, 'pt-BR': GOOD_SCENARIO['pt-BR'] },
        requestedLocales(req.messages[0]!.content),
      );
    });
    const res = await writeLocalizedTexts(await request(llm));
    expect(llm.calls).toBe(2);
    expect(requestedLocales(llm.requests[1]!.messages[0]!.content)).toEqual(['pt-BR', 'es-AR', 'es-MX']);
    expect(llm.requests[1]!.messages.at(-1)!.content).toMatch(/número que não está nos fatos/);
    const by = Object.fromEntries(res.texts.map((t) => [t.locale, t]));
    expect(by['pt-BR']).toMatchObject({ origin: 'llm', attempts: 2 });
    expect(confidenceOf(by['pt-BR']!)).toBe(0.8);
    expect(by['es-MX']).toMatchObject({ origin: 'fallback', fallbackReason: 'rejected', attempts: 2 });
    expect(by['es-MX']!.rejected[0]!.violations.map((v) => v.kind)).toContain('unknown_name');
    expect(by['es-AR']!.rejected[0]!.violations.map((v) => v.kind)).toContain('forbidden_insult');
    expect(by['es-AR']!.text).toBe(joinSentences((await request(null)).fallback('es-AR')));
    expect(by['es-CO']).toMatchObject({ origin: 'llm', attempts: 1 });
  });

  it('erro do LLM (ex.: orçamento estourado) → fallback em todos os locales', async () => {
    const llm = new FakeLlmClient([new Error('orçamento diário de tokens esgotado')]);
    const res = await writeLocalizedTexts(await request(llm));
    expect(llm.calls).toBe(2);
    expect(res.errors[0]).toMatch(/orçamento/);
    expect(res.texts.every((t) => t.origin === 'fallback' && t.fallbackReason === 'llm_error')).toBe(true);
  });

  it('sem LLM → texto determinístico, sem chamadas', async () => {
    const res = await writeLocalizedTexts(await request(null));
    expect(res.llmCalls).toBe(0);
    expect(res.texts.every((t) => t.origin === 'fallback' && t.fallbackReason === 'no_llm')).toBe(true);
    expect(res.texts.every((t) => confidenceOf(t) === 1)).toBe(true);
  });

  it('locale ausente na resposta também é refeito', async () => {
    const llm = new FakeLlmClient((req) =>
      llmTexts(
        Object.fromEntries(
          Object.entries(GOOD_SCENARIO).filter(([l]) => l !== 'es-PE' || req.messages.length > 1),
        ),
        requestedLocales(req.messages[0]!.content),
      ),
    );
    const res = await writeLocalizedTexts(await request(llm));
    expect(llm.calls).toBe(2);
    expect(res.texts.find((t) => t.locale === 'es-PE')).toMatchObject({ origin: 'llm', attempts: 2 });
  });
});
