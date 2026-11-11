import type { EmbeddingClient } from '@galaxie/llm';
import { describe, expect, it, vi } from 'vitest';
import type { DocChunk } from './assistant.js';
import { embeddingClientFor, fuseRankings, searchKnowledge } from './knowledge.js';

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
});

describe('busca na base de conhecimento', () => {
  const docs = [doc('Webhooks', 'assinatura HMAC dos webhooks'), doc('Escalações', 'lineups do jogo')];
  const db = {} as never;

  it('sem cliente de embeddings: só por palavras', async () => {
    const hits = await searchKnowledge('webhook HMAC', docs, { db, client: null });
    expect(hits.map((h) => h.title)).toEqual(['Webhooks']);
  });

  it('falha do provedor volta para a busca por palavras', async () => {
    const client: EmbeddingClient = {
      provider: 'openai',
      model: 'falha',
      dimensions: 2,
      embed: vi.fn(async () => {
        throw new Error('fora do ar');
      }),
    };
    const failing = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      insert: () => ({}),
    } as never;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hits = await searchKnowledge('webhook HMAC', docs, { db: failing, client });
    expect(hits.map((h) => h.title)).toEqual(['Webhooks']);
    spy.mockRestore();
  });
});
