import type { EmbeddingClient } from '@galaxie/llm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocChunk } from './assistant.js';
import {
  DOCS_BUDGET_CHARS,
  embeddingClientFor,
  fitDocs,
  fuseRankings,
  knowledgeTesting,
  searchKnowledge,
} from './knowledge.js';

const doc = (title: string, text: string): DocChunk => ({ title, href: `/docs#${title}`, text });

describe('fusão de rankings', () => {
  it('quem aparece bem nas duas listas sobe', () => {
    const fused = fuseRankings(
      [
        ['a', 'b', 'c'],
        ['b', 'd', 'a'],
      ],
      (x) => x,
    );
    expect(fused[0]).toBe('b');
    expect(fused).toHaveLength(4);
  });
});

describe('cliente de embeddings pelo ajuste', () => {
  it('auto usa a primeira chave da Cosmos (OpenAI, depois Gemini); off ou sem chave: nenhum', () => {
    expect(embeddingClientFor('auto', { COSMOS_GEMINI_API_KEY: 'g' })?.provider).toBe('gemini');
    expect(
      embeddingClientFor('auto', { COSMOS_OPENAI_API_KEY: 'o', COSMOS_GEMINI_API_KEY: 'g' })?.provider,
    ).toBe('openai');
    expect(embeddingClientFor('gemini', { COSMOS_OPENAI_API_KEY: 'o' })).toBeNull();
    expect(embeddingClientFor('off', { COSMOS_OPENAI_API_KEY: 'o' })).toBeNull();
    expect(embeddingClientFor('auto', { COSMOS_ANTHROPIC_API_KEY: 'a' })).toBeNull();
  });

  it('auto prefere o provedor da função quando ele tem embeddings', () => {
    const env = { COSMOS_OPENAI_API_KEY: 'o', COSMOS_GEMINI_API_KEY: 'g' };
    expect(embeddingClientFor('auto', env, { preferred: 'gemini' })?.provider).toBe('gemini');
    expect(embeddingClientFor('auto', env, { preferred: 'anthropic' })?.provider).toBe('openai');
    // escolha explícita no ajuste vale mais que a preferência
    expect(embeddingClientFor('openai', env, { preferred: 'gemini' })?.provider).toBe('openai');
  });
});

describe('orçamento da documentação', () => {
  it('trechos entram em ordem até o teto; o que passa entra cortado ou fica de fora', () => {
    const big = (t: string) => doc(t, 'x'.repeat(1500));
    const fitted = fitDocs([big('a'), big('b'), big('c'), big('d')]);
    const size = fitted.map((d) => `### ${d.title} (${d.href})\n${d.text}`).join('\n\n').length;
    expect(size).toBeLessThanOrEqual(DOCS_BUDGET_CHARS);
    expect(fitted.slice(0, 3).map((d) => d.text.length)).toEqual([1500, 1500, 1500]);
    expect(fitDocs([big('a'), big('b')], 2000).map((d) => d.text.length)).toEqual([1500, expect.any(Number)]);
    expect(fitDocs([big('a'), big('b')], 1600)).toHaveLength(1);
  });
});

describe('busca na base de conhecimento', () => {
  afterEach(() => knowledgeTesting.reset());
  const docs = [doc('Webhooks', 'assinatura HMAC dos webhooks'), doc('Escalações', 'lineups do jogo')];
  const db = {} as never;

  it('sem cliente de embeddings: só por palavras', async () => {
    const hits = await searchKnowledge('webhook HMAC', docs, { db, client: null });
    expect(hits.map((h) => h.title)).toEqual(['Webhooks']);
  });

  const memoryDb = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
  } as never;

  it('falha do provedor no vetor da pergunta volta para a busca por palavras', async () => {
    const client: EmbeddingClient = {
      provider: 'openai',
      model: 'falha',
      dimensions: 2,
      embed: vi.fn(async (texts, opts) => {
        if (opts?.kind === 'query') throw new Error('fora do ar');
        return { vectors: texts.map(() => [1, 0]), tokens: 0 };
      }),
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await searchKnowledge('webhook HMAC', docs, { db: memoryDb, client });
    await knowledgeTesting.settle(client);
    const hits = await searchKnowledge('webhook HMAC', docs, { db: memoryDb, client });
    expect(hits.map((h) => h.title)).toEqual(['Webhooks']);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('busca por significado indisponível'),
      expect.any(Error),
    );
    spy.mockRestore();
  });

  it('saudação não puxa trecho pela busca por significado (piso e distância do melhor)', async () => {
    const vec: Record<string, number[]> = {
      Webhooks: [0.2, 0.98],
      Escalações: [0.98, 0.2],
    };
    const client: EmbeddingClient = {
      provider: 'openai',
      model: 'saudacao',
      dimensions: 2,
      embed: vi.fn(async (texts, opts) => ({
        vectors: texts.map((t: string) =>
          opts?.kind === 'query' ? [-0.7, -0.7] : (vec[t.split('\n')[0]!] ?? [0, 0]),
        ),
        tokens: 0,
      })),
    };
    await searchKnowledge('olá', docs, { db: memoryDb, client });
    await knowledgeTesting.settle(client);
    expect(await searchKnowledge('olá', docs, { db: memoryDb, client })).toEqual([]);
  });
});
