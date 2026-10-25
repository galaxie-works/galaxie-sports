import { describe, expect, it } from 'vitest';
import { knockoutStageRules, knockoutStakes, titleChaseStakes } from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { AGENT_LOCALES, checkGeneratedText, joinSentences, type AgentLocale } from '../guardrails/index.js';
import { FakeLlmClient } from '../testing/fake-llm.js';
import { llmTexts, sampleCore } from '../testing/samples.js';
import {
  buildScenarioFacts,
  SCENARIO_PROMPT_VERSION,
  scenarioFactSheet,
  scenarioFallback,
  scenarioSystemPrompt,
  scenarioUserPrompt,
} from './scenario.js';
import type { EventStakes } from './stakes.js';
import { writeLocalizedTexts, type LocalizedWriteRequest } from './writer.js';

/** Final da Libertadores 2026 em jogo único: Palmeiras (3 títulos) × Estudiantes (4). */
const core = sampleCore({
  stage: {
    id: '00000000-0000-7000-8000-0000000000f1',
    kind: 'final',
    name: { 'pt-BR': 'Final', es: 'Final', en: 'Final' },
    providerLabel: 'Final',
  },
  startsAt: new Date('2026-11-28T15:00:00Z'),
  venue: { name: 'Estadio Centenario', city: 'Montevideo' },
  away: {
    id: 'away-id',
    side: 'away',
    name: 'Estudiantes L.P.',
    shortName: 'EST',
    aliases: [],
    labels: { 'pt-BR': 'Estudiantes', es: 'Estudiantes' },
  },
});

async function finalStakes(): Promise<EventStakes> {
  const rules = await loadCompetitionRules('conmebol-libertadores', { season: 2026 });
  const stage = knockoutStageRules(rules, 'final');
  const titles = {
    home: { won: 3, seasons: ['1999', '2020', '2021'], editionQids: ['Q1', 'Q2', 'Q3'] },
    away: { won: 4, seasons: ['1968', '1969', '1970', '2009'], editionQids: ['Q4', 'Q5', 'Q6', 'Q7'] },
  };
  return {
    stakes: [...knockoutStakes({ rules: stage }), ...titleChaseStakes(['home', 'away'], titles)],
    rules,
    knockout: {
      legs: 1,
      leg: null,
      extraTime: stage.extraTime,
      penalties: stage.penalties,
      decidesTitle: stage.decidesTitle,
    },
    titles,
  };
}

async function request(llm: FakeLlmClient | null): Promise<LocalizedWriteRequest> {
  const stakes = await finalStakes();
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

const PT = [
  'Final em jogo único: quem vencer é campeão.',
  'O Palmeiras busca o tetra da Libertadores; o Estudiantes, o penta.',
  'Empate leva à prorrogação e, se persistir, pênaltis.',
];
const ES = [
  'Final a partido único: el que gane es campeón.',
  'Palmeiras va por el tetra de la Libertadores y Estudiantes, por el penta.',
  'Si empatan, hay alargue y después penales.',
];

describe('cenário da final: estrutura do jogo e histórico nos fatos', () => {
  it('versão do prompt sobe para regenerar o cache', () => {
    expect(SCENARIO_PROMPT_VERSION).toBe('scenario@v3');
  });

  it('fatos trazem decides_title, prorrogação e os títulos anteriores de cada time', async () => {
    const facts = buildScenarioFacts(core, await finalStakes(), AGENT_LOCALES);
    expect(facts.knockout).toMatchObject({ legs: 1, decides_title: true, extra_time: true, penalties: true });
    expect(facts.history?.titles).toEqual({
      home: { won: 3, seeking: 4, seasons: ['1999', '2020', '2021'], last_title: '2021' },
      away: { won: 4, seeking: 5, seasons: ['1968', '1969', '1970', '2009'], last_title: '2009' },
    });
    expect(facts.stakes.map((s) => s.labels['pt-BR'])).toContain('Busca o tetracampeonato');
    expect(facts.stakes.map((s) => s.labels['pt-BR'])).not.toContain('Precisa vencer para avançar direto');
  });

  it('última final entre os dois entra nos fatos e no validador', async () => {
    const lastFinal = {
      season: 2009,
      home: 'Palmeiras',
      away: 'Estudiantes L.P.',
      home_goals: 1,
      away_goals: 2,
      winner: 'away' as const,
    };
    const stakes = await finalStakes();
    const facts = buildScenarioFacts(core, stakes, AGENT_LOCALES, { lastFinal });
    expect(facts.history?.last_final_between).toEqual(lastFinal);
    const sheet = scenarioFactSheet(core, facts, stakes.stakes, 'pt-BR');
    expect(sheet.numbers).toContain(2009);
    expect(sheet.scores).toContainEqual([1, 2]);
  });

  it('prompt manda ler a final como decisão de título e usar o histórico, sem inventar', () => {
    const prompt = scenarioSystemPrompt();
    expect(prompt).toMatch(/decides_title = true/);
    expect(prompt).toMatch(/Nunca fale em avançar/);
    expect(prompt).toMatch(/history/);
    expect(prompt).toMatch(/Não invente números/);
    expect(prompt).not.toMatch(/não deduza cenários novos/);
  });

  it('fallback pt-BR e es-AR: campeão, tetra e penta, prorrogação', async () => {
    const req = await request(null);
    expect(req.fallback('pt-BR')).toEqual([
      'Final em jogo único: quem vencer é campeão',
      'Palmeiras busca o tetracampeonato; Estudiantes busca o pentacampeonato',
      'Empate leva o jogo à prorrogação; em caso de igualdade, prorrogação e depois pênaltis',
    ]);
    expect(req.fallback('es-AR')).toEqual([
      'Final a partido único: el que gane es campeón',
      'Palmeiras va por el tetracampeonato; Estudiantes va por el pentacampeonato',
      'El empate lleva el partido al alargue; si hay igualdad, alargue y después penales',
    ]);
    for (const l of AGENT_LOCALES) expect(joinSentences(req.fallback(l))).not.toMatch(/avan[çcz]|vaga/i);
  });

  it.each(AGENT_LOCALES)('fallback da final passa nos guardrails (%s)', async (locale: AgentLocale) => {
    const req = await request(null);
    const text = joinSentences(req.fallback(locale));
    expect(checkGeneratedText(text, { locale, facts: req.factsFor(locale), surface: 'tv' })).toEqual([]);
  });

  it('LLM (provedor falso) com o texto esperado passa de primeira', async () => {
    const map = Object.fromEntries(AGENT_LOCALES.map((l) => [l, l === 'pt-BR' ? PT : ES]));
    const llm = new FakeLlmClient([llmTexts(map)]);
    const res = await writeLocalizedTexts(await request(llm));
    expect(res.texts.every((t) => t.origin === 'llm' && t.attempts === 1)).toBe(true);
    expect(res.texts.find((t) => t.locale === 'pt-BR')!.text).toBe(PT.join(' '));
    // o LLM recebe o histórico nos fatos
    expect(llm.requests[0]!.messages[0]!.content).toContain('"seeking":4');
  });

  it('validador recusa título e ano inventados (hexa, 2015) e o writer cai no fallback', async () => {
    const invented = {
      'pt-BR': ['Final em jogo único: o Palmeiras busca o hexa, depois do título de 2015.'],
    };
    const req = await request(null);
    const violations = checkGeneratedText(joinSentences(invented['pt-BR']), {
      locale: 'pt-BR',
      facts: req.factsFor('pt-BR'),
      surface: 'tv',
    });
    expect(violations.map((v) => `${v.kind}:${v.value}`)).toEqual(
      expect.arrayContaining(['unknown_number:hexa', 'unknown_number:2015']),
    );
    const llm = new FakeLlmClient(() => llmTexts(invented, ['pt-BR']));
    const res = await writeLocalizedTexts({ ...(await request(llm)), locales: ['pt-BR'] });
    expect(res.texts[0]).toMatchObject({ origin: 'fallback', fallbackReason: 'rejected', attempts: 2 });
  });
});
