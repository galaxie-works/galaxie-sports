import { docEmbedding, type Database } from '@galaxie/db';
import type { EmbeddingClient } from '@galaxie/llm';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeTesting, searchKnowledge, vectorKey, type DocChunk } from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
});
afterAll(async () => temp?.close());
beforeEach(() => knowledgeTesting.reset());

const docs: DocChunk[] = [
  {
    title: 'Escalações',
    href: '/docs/referencia#get-v1-lineups',
    text: 'GET /v1/lineups titulares e reservas',
  },
  { title: 'Webhooks', href: '/docs/tempo-real', text: 'assinatura HMAC dos avisos em tempo real' },
];

/** Vetores de brinquedo: "escalação/time/titular" aponta para um eixo, o resto para o outro. */
function fakeClient(model: string): EmbeddingClient & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    provider: 'openai',
    model,
    dimensions: 2,
    calls,
    async embed(texts) {
      calls.push([...texts]);
      return {
        vectors: texts.map((t) => (/escala|time|titular|lineup/i.test(t) ? [1, 0] : [0, 1])),
        tokens: 0,
      };
    },
  };
}

describe('busca por significado', () => {
  it('primeira pergunta: só palavras e calcula os vetores em segundo plano; depois acha pelo sentido', async () => {
    const client = fakeClient('brinquedo-1');
    // sem nenhuma palavra em comum com os trechos
    const first = await searchKnowledge('quem joga como titular hoje?', docs, { db, client, limit: 1 });
    await knowledgeTesting.settle(client);
    const second = await searchKnowledge('quem joga como titular hoje?', docs, { db, client, limit: 1 });
    expect(second[0]?.title).toBe('Escalações');
    expect(first.length).toBeLessThanOrEqual(1);
    const rows = await db
      .select()
      .from(docEmbedding)
      .where(eq(docEmbedding.model, vectorKey(client)));
    expect(rows).toHaveLength(2);
  });

  it('outro processo reaproveita os vetores do banco sem chamar o provedor para os trechos', async () => {
    const a = fakeClient('brinquedo-2');
    await searchKnowledge('time', docs, { db, client: a });
    await knowledgeTesting.settle(a);
    knowledgeTesting.reset();
    const b = fakeClient('brinquedo-2');
    await searchKnowledge('time', docs, { db, client: b });
    await knowledgeTesting.settle(b);
    // só o vetor da pergunta (os trechos vieram do banco)
    const hits = await searchKnowledge('time', docs, { db, client: b, limit: 1 });
    expect(hits[0]?.title).toBe('Escalações');
    expect(b.calls.every((c) => c.length === 1)).toBe(true);
  });

  it('falha do provedor: não tenta de novo a cada pergunta (espera antes da próxima tentativa)', async () => {
    const client = fakeClient('brinquedo-3');
    let fail = true;
    const embed = client.embed.bind(client);
    client.embed = async (texts, opts) => {
      if (fail) throw new Error('fora do ar');
      return embed(texts, opts);
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const now = Date.now();
    await searchKnowledge('time', docs, { db, client, now });
    await knowledgeTesting.settle(client);
    fail = false;
    // logo depois da falha: só palavras, sem chamar o provedor
    await searchKnowledge('time', docs, { db, client, now: now + 1000 });
    await knowledgeTesting.settle(client);
    expect(client.calls).toHaveLength(0);
    // passada a espera, calcula
    await searchKnowledge('time', docs, { db, client, now: now + 11 * 60_000 });
    await knowledgeTesting.settle(client);
    expect(client.calls.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
