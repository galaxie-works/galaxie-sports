/**
 * Base de conhecimento do assistente: busca híbrida nos trechos da documentação (guias de /docs e contrato
 * OpenAPI). Junta a busca por palavras (`searchDocs`) com a busca por significado (embeddings) pela fusão de
 * rankings (RRF), então a pergunta "como pego a escalação?" acha o endpoint de lineups mesmo sem a palavra exata.
 *
 * Os vetores dos trechos são calculados uma vez por modelo e guardados em `cosmos.doc_embedding` (sem dado de
 * cliente). O primeiro cálculo roda em segundo plano: enquanto não termina, ou se o provedor falhar, a pergunta
 * segue só com a busca por palavras, sem atraso. O vetor da pergunta custa frações de centavo e não vira crédito.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { docEmbedding } from '@galaxie/db/schema';
import { cosine, createEmbeddingClient, type EmbeddingClient, type EmbeddingProvider } from '@galaxie/llm';
import { searchDocs, type DocChunk } from './assistant.js';
import { cosmosApiKey } from './models.js';
import type { EmbeddingsSetting } from './settings.js';

/** Constante da fusão de rankings (RRF); 60 é o valor da literatura. */
const RRF_K = 60;
/** Candidatos de cada busca antes da fusão. */
const CANDIDATES = 20;
/** Abaixo disso o trecho não tem a ver com a pergunta, mesmo sendo o mais perto. */
const MIN_SIMILARITY = 0.25;
/** Tempo máximo para o vetor da pergunta; passou, vale só a busca por palavras. */
const QUESTION_TIMEOUT_MS = 3000;

export const chunkHash = (d: DocChunk) => createHash('sha256').update(`${d.title}\n${d.text}`).digest('hex');
const chunkInput = (d: DocChunk) => `${d.title}\n${d.text}`;

/** Cliente de embeddings pelo ajuste: `auto` usa a primeira chave da Cosmos (OpenAI, depois Gemini). */
export function embeddingClientFor(
  setting: EmbeddingsSetting,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: Parameters<typeof createEmbeddingClient>[0]['fetch'],
): EmbeddingClient | null {
  if (setting === 'off') return null;
  const order: EmbeddingProvider[] = setting === 'auto' ? ['openai', 'gemini'] : [setting];
  for (const provider of order) {
    const apiKey = cosmosApiKey(provider, env);
    if (apiKey)
      return createEmbeddingClient({ provider, apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }
  return null;
}

/** Fusão de rankings: cada lista dá 1/(k + posição) a cada item; a soma ordena. */
export function fuseRankings<T>(lists: readonly (readonly T[])[], key: (t: T) => string, k = RRF_K): T[] {
  const score = new Map<string, { item: T; score: number }>();
  for (const list of lists)
    list.forEach((item, i) => {
      const id = key(item);
      const prev = score.get(id);
      score.set(id, { item, score: (prev?.score ?? 0) + 1 / (k + i + 1) });
    });
  return [...score.values()].sort((a, b) => b.score - a.score).map((x) => x.item);
}

/** Vetores já calculados, por modelo e hash, neste processo. */
const memory = new Map<string, Map<string, number[]>>();
/** Cálculo em andamento por modelo (um por vez). */
const warming = new Map<string, Promise<void>>();

type Db = Pick<Database, 'select' | 'insert'>;

/** Carrega do banco e calcula o que falta; grava o novo. Erro sobe (quem chama decide). */
async function warm(db: Db, client: EmbeddingClient, docs: readonly DocChunk[]): Promise<void> {
  const cache = memory.get(client.model) ?? new Map<string, number[]>();
  memory.set(client.model, cache);
  const byHash = new Map(docs.map((d) => [chunkHash(d), d]));
  let missing = [...byHash.keys()].filter((h) => !cache.has(h));
  for (let i = 0; i < missing.length; i += 500) {
    const slice = missing.slice(i, i + 500);
    const rows = await db
      .select({ hash: docEmbedding.contentHash, vector: docEmbedding.vector })
      .from(docEmbedding)
      .where(and(eq(docEmbedding.model, client.model), inArray(docEmbedding.contentHash, slice)));
    for (const r of rows) cache.set(r.hash, r.vector);
  }
  missing = missing.filter((h) => !cache.has(h));
  if (!missing.length) return;
  const { vectors } = await client.embed(
    missing.map((h) => chunkInput(byHash.get(h)!)),
    { timeoutMs: 120_000 },
  );
  const rows = missing.map((h, i) => ({ model: client.model, contentHash: h, vector: vectors[i]! }));
  for (let i = 0; i < rows.length; i += 200)
    await db
      .insert(docEmbedding)
      .values(rows.slice(i, i + 200))
      .onConflictDoNothing();
  rows.forEach((r) => cache.set(r.contentHash, r.vector));
}

/** Os vetores de todos os trechos, ou null se ainda não estão prontos (aí dispara o cálculo em segundo plano). */
function vectorsOrWarm(
  db: Db,
  client: EmbeddingClient,
  docs: readonly DocChunk[],
): Map<string, number[]> | null {
  const cache = memory.get(client.model);
  if (cache && docs.every((d) => cache.has(chunkHash(d)))) return cache;
  if (!warming.has(client.model)) {
    const job = warm(db, client, docs)
      .catch((err) => console.error('[cosmos] vetores da documentação não foram calculados', err))
      .finally(() => warming.delete(client.model));
    warming.set(client.model, job);
  }
  return null;
}

/** Só para testes: espera o cálculo em andamento e limpa a memória do processo. */
export const knowledgeTesting = {
  settle: (model: string) => warming.get(model) ?? Promise.resolve(),
  reset: () => {
    memory.clear();
    warming.clear();
  },
};

/**
 * Trechos para a pergunta: busca por palavras e, com cliente de embeddings e os vetores prontos, também por
 * significado, com fusão das duas. Nunca falha por causa dos embeddings: volta para a busca por palavras.
 */
export async function searchKnowledge(
  question: string,
  docs: readonly DocChunk[],
  options: { db: Db; client: EmbeddingClient | null; limit?: number; signal?: AbortSignal },
): Promise<DocChunk[]> {
  const limit = options.limit ?? 4;
  const byWords = searchDocs(question, docs, CANDIDATES);
  if (!options.client || !docs.length) return byWords.slice(0, limit);
  try {
    const vectors = vectorsOrWarm(options.db, options.client, docs);
    if (!vectors) return byWords.slice(0, limit);
    const {
      vectors: [q],
    } = await options.client.embed([question], {
      timeoutMs: QUESTION_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const byMeaning = docs
      .map((d) => ({ d, s: cosine(q!, vectors.get(chunkHash(d))!) }))
      .filter((x) => x.s >= MIN_SIMILARITY)
      .sort((a, b) => b.s - a.s)
      .slice(0, CANDIDATES)
      .map((x) => x.d);
    return fuseRankings([byMeaning, byWords], chunkHash).slice(0, limit);
  } catch (err) {
    console.error('[cosmos] busca por significado indisponível, seguindo por palavras', err);
    return byWords.slice(0, limit);
  }
}
