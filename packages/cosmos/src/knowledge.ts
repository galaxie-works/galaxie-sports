/**
 * Base de conhecimento do assistente: busca híbrida nos trechos da documentação (guias de /docs e contrato
 * OpenAPI). Junta a busca por palavras (`searchDocs`) com a busca por significado (embeddings) pela fusão de
 * rankings (RRF), então a pergunta "como pego a escalação?" acha o endpoint de lineups mesmo sem a palavra exata.
 *
 * Os vetores dos trechos são calculados uma vez por modelo e guardados em `cosmos.doc_embedding` (sem dado de
 * cliente), lote a lote. O cálculo roda em segundo plano: enquanto não termina, ou se o provedor falhar, a pergunta
 * segue só com a busca por palavras, sem atraso; depois de uma falha, a próxima tentativa espera (10 min, dobrando
 * até 1 h). O vetor da pergunta custa frações de centavo e não vira crédito.
 *
 * Os créditos da pergunta não dependem do que a busca acha: a documentação entra no prompt dentro de um orçamento
 * fixo (`DOCS_BUDGET_CHARS`), e a estimativa conta o orçamento inteiro. Assim a estimativa da tela (que só busca
 * por palavras, sem chamar provedor) e a reserva da pergunta pedem o mesmo número.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { docEmbedding } from '@galaxie/db/schema';
import {
  cosine,
  createEmbeddingClient,
  EMBEDDING_BATCH,
  EMBEDDING_PROVIDERS,
  type EmbeddingClient,
  type EmbeddingProvider,
} from '@galaxie/llm';
import { searchDocs, type DocChunk } from './assistant.js';
import { cosmosApiKey } from './models.js';
import type { EmbeddingsSetting } from './settings.js';

/** Constante da fusão de rankings (RRF); 60 é o valor da literatura. */
const RRF_K = 60;
/** Candidatos de cada busca antes da fusão. */
const CANDIDATES = 20;
/**
 * Piso de similaridade por provedor: os dois modelos espalham o cosseno em faixas diferentes (o da Gemini fica bem
 * mais alto para texto sem relação). Abaixo do piso, o trecho não tem a ver com a pergunta, mesmo sendo o mais perto.
 */
const MIN_SIMILARITY: Record<EmbeddingProvider, number> = { openai: 0.3, gemini: 0.6 };
/** Além do piso, só entra quem está perto do melhor: "Olá" não puxa trechos só por serem os menos distantes. */
const SIMILARITY_SPREAD = 0.1;
/** Tempo máximo para o vetor da pergunta; passou, vale só a busca por palavras. */
const QUESTION_TIMEOUT_MS = 1500;
/** Trechos por pergunta. */
export const KNOWLEDGE_LIMIT = 3;
/** Teto de caracteres da documentação no prompt (os trechos têm até 1500). A estimativa conta este teto inteiro. */
export const DOCS_BUDGET_CHARS = 4800;
/** Espera depois de uma falha no cálculo dos vetores: começa em 10 min e dobra até 1 h. */
const BACKOFF_MS = 10 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;

const chunkInput = (d: DocChunk) => `${d.title}\n${d.text}`;
const hashes = new WeakMap<DocChunk, string>();
export function chunkHash(d: DocChunk): string {
  let h = hashes.get(d);
  if (!h) {
    h = createHash('sha256').update(chunkInput(d)).digest('hex');
    hashes.set(d, h);
  }
  return h;
}

/** Chave do vetor no banco e na memória: modelo e dimensão (mudar a dimensão não mistura vetores). */
export const vectorKey = (client: Pick<EmbeddingClient, 'model' | 'dimensions'>) =>
  `${client.model}@${client.dimensions}`;

/**
 * Cliente de embeddings pelo ajuste. `auto` usa o provedor da função quando ele tem embeddings (a pergunta não vai a
 * um provedor a mais); senão, a primeira chave da Cosmos (OpenAI, depois Gemini).
 */
export function embeddingClientFor(
  setting: EmbeddingsSetting,
  env: Record<string, string | undefined> = process.env,
  options: { preferred?: string; fetch?: Parameters<typeof createEmbeddingClient>[0]['fetch'] } = {},
): EmbeddingClient | null {
  if (setting === 'off') return null;
  const preferred = (EMBEDDING_PROVIDERS as readonly string[]).includes(options.preferred ?? '')
    ? [options.preferred as EmbeddingProvider]
    : [];
  const order: EmbeddingProvider[] =
    setting === 'auto' ? [...new Set([...preferred, 'openai', 'gemini'] as EmbeddingProvider[])] : [setting];
  for (const provider of order) {
    const apiKey = cosmosApiKey(provider, env);
    if (apiKey)
      return createEmbeddingClient({ provider, apiKey, ...(options.fetch ? { fetch: options.fetch } : {}) });
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

/** Como o trecho aparece no prompt (`buildPrompt`). */
const rendered = (d: DocChunk) => `### ${d.title} (${d.href})\n${d.text}`;

/**
 * Corta os trechos para caberem no orçamento da documentação: entram em ordem; o que não cabe inteiro entra cortado
 * se ainda sobrar espaço útil, e o resto fica de fora.
 */
export function fitDocs(docs: readonly DocChunk[], budget = DOCS_BUDGET_CHARS): DocChunk[] {
  const out: DocChunk[] = [];
  // os trechos são separados por uma linha em branco no prompt
  let left = budget;
  for (const d of docs) {
    const sep = out.length ? 2 : 0;
    const size = rendered(d).length + sep;
    if (size <= left) {
      out.push(d);
      left -= size;
      continue;
    }
    const room = left - sep - (rendered(d).length - d.text.length);
    if (room >= 200) out.push({ ...d, text: d.text.slice(0, room) });
    break;
  }
  return out;
}

/** Vetores já calculados, por chave do modelo e hash, neste processo. */
const memory = new Map<string, Map<string, number[]>>();
/** Cálculo em andamento por modelo (um por vez). */
const warming = new Map<string, Promise<void>>();
/** Depois de uma falha: quando pode tentar de novo e a próxima espera. */
const backoff = new Map<string, { until: number; next: number }>();

type Db = Pick<Database, 'select' | 'insert'>;

/** Carrega do banco e calcula o que falta, gravando a cada lote (uma falha no meio não perde o que já saiu). */
async function warm(db: Db, client: EmbeddingClient, docs: readonly DocChunk[]): Promise<void> {
  const key = vectorKey(client);
  const cache = memory.get(key) ?? new Map<string, number[]>();
  memory.set(key, cache);
  const byHash = new Map(docs.map((d) => [chunkHash(d), d]));
  let missing = [...byHash.keys()].filter((h) => !cache.has(h));
  for (let i = 0; i < missing.length; i += 500) {
    const slice = missing.slice(i, i + 500);
    const rows = await db
      .select({ hash: docEmbedding.contentHash, vector: docEmbedding.vector })
      .from(docEmbedding)
      .where(and(eq(docEmbedding.model, key), inArray(docEmbedding.contentHash, slice)));
    for (const r of rows) cache.set(r.hash, r.vector);
  }
  missing = missing.filter((h) => !cache.has(h));
  for (let i = 0; i < missing.length; i += EMBEDDING_BATCH) {
    const slice = missing.slice(i, i + EMBEDDING_BATCH);
    const { vectors } = await client.embed(
      slice.map((h) => chunkInput(byHash.get(h)!)),
      { timeoutMs: 60_000, kind: 'document' },
    );
    const rows = slice.map((h, j) => ({ model: key, contentHash: h, vector: vectors[j]! }));
    await db.insert(docEmbedding).values(rows).onConflictDoNothing();
    rows.forEach((r) => cache.set(r.contentHash, r.vector));
  }
}

/** Os vetores de todos os trechos, ou null se ainda não estão prontos (aí dispara o cálculo em segundo plano). */
function vectorsOrWarm(
  db: Db,
  client: EmbeddingClient,
  docs: readonly DocChunk[],
  now: number,
): Map<string, number[]> | null {
  const key = vectorKey(client);
  const cache = memory.get(key);
  if (cache && docs.every((d) => cache.has(chunkHash(d)))) return cache;
  const wait = backoff.get(key);
  if (!warming.has(key) && !(wait && now < wait.until)) {
    const job = warm(db, client, docs)
      .then(() => {
        backoff.delete(key);
      })
      .catch((err) => {
        const next = wait?.next ?? BACKOFF_MS;
        backoff.set(key, { until: Date.now() + next, next: Math.min(next * 2, BACKOFF_MAX_MS) });
        console.error('[cosmos] vetores da documentação não foram calculados', err);
      })
      .finally(() => warming.delete(key));
    warming.set(key, job);
  }
  return null;
}

/** Só para testes: espera o cálculo em andamento e limpa a memória do processo. */
export const knowledgeTesting = {
  settle: (client: Pick<EmbeddingClient, 'model' | 'dimensions'>) =>
    warming.get(vectorKey(client)) ?? Promise.resolve(),
  reset: () => {
    memory.clear();
    warming.clear();
    backoff.clear();
  },
};

/**
 * Trechos para a pergunta, já dentro do orçamento da documentação: busca por palavras e, com cliente de embeddings
 * e os vetores prontos, também por significado, com fusão das duas. Nunca falha por causa dos embeddings: volta para
 * a busca por palavras.
 */
export async function searchKnowledge(
  question: string,
  docs: readonly DocChunk[],
  options: { db: Db; client: EmbeddingClient | null; limit?: number; signal?: AbortSignal; now?: number },
): Promise<DocChunk[]> {
  const limit = options.limit ?? KNOWLEDGE_LIMIT;
  const byWords = searchDocs(question, docs, CANDIDATES);
  const words = () => fitDocs(byWords.slice(0, limit));
  if (!options.client || !docs.length) return words();
  try {
    const vectors = vectorsOrWarm(options.db, options.client, docs, options.now ?? Date.now());
    if (!vectors) return words();
    const {
      vectors: [q],
    } = await options.client.embed([question], {
      timeoutMs: QUESTION_TIMEOUT_MS,
      kind: 'query',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const scored = docs
      .map((d) => ({ d, s: cosine(q!, vectors.get(chunkHash(d))!) }))
      .sort((a, b) => b.s - a.s);
    const floor = Math.max(MIN_SIMILARITY[options.client.provider], (scored[0]?.s ?? 0) - SIMILARITY_SPREAD);
    const byMeaning = scored
      .filter((x) => x.s >= floor)
      .slice(0, CANDIDATES)
      .map((x) => x.d);
    return fitDocs(fuseRankings([byMeaning, byWords], chunkHash).slice(0, limit));
  } catch (err) {
    console.error('[cosmos] busca por significado indisponível, seguindo por palavras', err);
    return words();
  }
}
