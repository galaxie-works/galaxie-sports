import { describe, expect, it } from 'vitest';
import { cosine, createEmbeddingClient, normalize } from '../embeddings.js';
import { fakeFetch, jsonResponse } from './test-helpers.js';

describe('embeddings', () => {
  it('OpenAI: lote em ordem de índice, dimensão pedida e vetores normalizados', async () => {
    const f = fakeFetch([
      jsonResponse(200, {
        data: [
          { index: 1, embedding: [0, 2] },
          { index: 0, embedding: [3, 4] },
        ],
        usage: { prompt_tokens: 7 },
      }),
    ]);
    const c = createEmbeddingClient({ provider: 'openai', apiKey: 'k', fetch: f });
    const r = await c.embed(['a', 'b']);
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/embeddings');
    expect(f.calls[0]!.body).toMatchObject({
      model: 'text-embedding-3-small',
      input: ['a', 'b'],
      dimensions: 768,
    });
    expect(r).toEqual({
      vectors: [
        [0.6, 0.8],
        [0, 1],
      ],
      tokens: 7,
    });
  });

  it('Gemini: batchEmbedContents com outputDimensionality, normaliza a dimensão reduzida', async () => {
    const f = fakeFetch([jsonResponse(200, { embeddings: [{ values: [0, 5] }] })]);
    const c = createEmbeddingClient({ provider: 'gemini', apiKey: 'k', fetch: f });
    const r = await c.embed(['oi'], { kind: 'query' });
    expect(f.calls[0]!.url).toContain('/models/gemini-embedding-001:batchEmbedContents');
    expect(f.calls[0]!.body).toMatchObject({
      requests: [
        {
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: 'oi' }] },
          outputDimensionality: 768,
          taskType: 'RETRIEVAL_QUERY',
        },
      ],
    });
    expect(r.vectors).toEqual([[0, 1]]);
  });

  it('erro do provedor sobe; quantidade de vetores diferente também', async () => {
    const c = createEmbeddingClient({
      provider: 'openai',
      apiKey: 'k',
      fetch: fakeFetch([jsonResponse(200, { data: [] })]),
    });
    await expect(c.embed(['a'])).rejects.toThrow(/0 vetores/);
  });

  it('cosseno de vetores normalizados', () => {
    expect(cosine(normalize([1, 0]), normalize([2, 0]))).toBeCloseTo(1);
    expect(cosine(normalize([1, 0]), normalize([0, 3]))).toBeCloseTo(0);
  });
});
