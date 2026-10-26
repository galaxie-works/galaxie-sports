import { describe, expect, it } from 'vitest';
import { FactSheetBuilder, surfaceFit } from '../guardrails/index.js';
import { BudgetExceededError } from '../llm/errors.js';
import { FakeLlmClient } from '../testing/fake-llm.js';
import {
  budgetFallbackExpired,
  fellBackOnLlmError,
  withoutBudgetDowngrade,
  type StoredContextContent,
} from './store.js';
import { writeLocalizedTexts } from './writer.js';

const content = (over: Partial<StoredContextContent>): StoredContextContent => ({
  text: 'Fim de jogo: Palmeiras 1 x 0 Corinthians.',
  sentences: ['Fim de jogo: Palmeiras 1 x 0 Corinthians'],
  origin: 'fallback',
  attempts: 2,
  rejected: [],
  factsHash: 'h',
  generatedAt: '2026-10-25T00:00:00.000Z',
  fits: surfaceFit('Fim de jogo: Palmeiras 1 x 0 Corinthians.'),
  run: {
    id: 'r',
    llmCalls: 2,
    usage: { inputTokens: 0, outputTokens: 0 },
    model: null,
    errors: ['tentativa 2: timeout'],
  },
  data: {},
  ...over,
});

describe('fellBackOnLlmError (regerar na próxima rodada)', () => {
  it('decide pelo motivo do locale, não pelos erros da execução inteira', () => {
    expect(fellBackOnLlmError(content({ fallbackReason: 'llm_error' }))).toBe(true);
    // reprovado nos guardrails numa execução que também teve erro: não volta a gastar LLM
    expect(fellBackOnLlmError(content({ fallbackReason: 'rejected' }))).toBe(false);
    expect(fellBackOnLlmError(content({ fallbackReason: 'missing' }))).toBe(false);
    expect(fellBackOnLlmError(content({ origin: 'llm', fallbackReason: 'llm_error' }))).toBe(false);
  });

  it('linha antiga, sem o motivo: vale a heurística pelos erros da execução', () => {
    expect(fellBackOnLlmError(content({}))).toBe(true);
    const ok = content({});
    ok.run = { ...ok.run, errors: [] };
    expect(fellBackOnLlmError(ok)).toBe(false);
  });
});

describe('motivo do texto determinístico (writeLocalizedTexts)', () => {
  it('locale ausente na 1ª resposta e erro do LLM na 2ª: llm_error (regera na próxima rodada)', async () => {
    const llm = new FakeLlmClient([{ texts: [] }, new Error('timeout')]);
    const res = await writeLocalizedTexts({
      locales: ['pt-BR'],
      system: 's',
      userPrompt: () => 'u',
      factsFor: () => new FactSheetBuilder().name('Palmeiras').build(),
      fallback: () => ['Fim de jogo'],
      surface: 'mobile',
      minSentences: 1,
      maxSentences: 4,
      llm,
      purpose: 'teste',
    });
    expect(res.texts[0]).toMatchObject({ origin: 'fallback', fallbackReason: 'llm_error' });
  });

  it('orçamento recusou (faixa esgotada): sem 2ª tentativa, texto determinístico e budgetSkipped', async () => {
    const llm = new FakeLlmClient([new BudgetExceededError('faixa:p1', 1.5, 1.5, 0, 'usd')]);
    const res = await writeLocalizedTexts({
      locales: ['pt-BR'],
      system: 's',
      userPrompt: () => 'u',
      factsFor: () => new FactSheetBuilder().name('Palmeiras').build(),
      fallback: () => ['Fim de jogo'],
      surface: 'mobile',
      minSentences: 1,
      maxSentences: 4,
      llm,
      purpose: 'teste',
      competition: { slug: 'premier-league' },
    });
    expect(llm.calls).toBe(1);
    expect(llm.requests[0]!.competition).toEqual({ slug: 'premier-league' });
    expect(res.budgetSkipped).toBe(true);
    expect(res.texts[0]).toMatchObject({
      origin: 'fallback',
      text: 'Fim de jogo.',
      fallbackReason: 'budget',
    });
  });
});

describe('determinístico por orçamento (fallbackReason budget)', () => {
  const budget = content({ fallbackReason: 'budget', generatedAt: '2026-10-26T15:00:00.000Z' });
  const day = { timeZone: 'America/Sao_Paulo', start: '06:00' };

  it('não é falha do LLM: não regera a cada rodada com os mesmos fatos', () => {
    expect(fellBackOnLlmError(budget)).toBe(false);
  });

  it('volta a tentar o LLM só depois da virada do dia de orçamento', () => {
    expect(budgetFallbackExpired(budget, { now: new Date('2026-10-27T08:59:00Z'), budgetDay: day })).toBe(
      false,
    );
    expect(budgetFallbackExpired(budget, { now: new Date('2026-10-27T09:00:00Z'), budgetDay: day })).toBe(
      true,
    );
    expect(budgetFallbackExpired(content({}), { now: new Date('2026-11-30T00:00:00Z') })).toBe(false);
  });

  it('nunca troca o texto do LLM com os mesmos fatos pelo determinístico do orçamento', () => {
    const texts = [
      { locale: 'pt-BR' as const, origin: 'fallback' as const, fallbackReason: 'budget' as const },
      { locale: 'es-AR' as const, origin: 'fallback' as const, fallbackReason: 'budget' as const },
    ];
    const previous = new Map([
      ['pt-BR', { origin: 'llm' as const, factsHash: 'h' }],
      ['es-AR', { origin: 'llm' as const, factsHash: 'outro' }],
    ]);
    // pt-BR fica com o texto do LLM; es-AR tem fatos novos e grava o determinístico
    expect(withoutBudgetDowngrade(texts, previous, 'h').map((t) => t.locale)).toEqual(['es-AR']);
  });
});
