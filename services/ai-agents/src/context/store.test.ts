import { describe, expect, it } from 'vitest';
import { surfaceFit } from '../guardrails/index.js';
import { fellBackOnLlmError, type StoredContextContent } from './store.js';

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
