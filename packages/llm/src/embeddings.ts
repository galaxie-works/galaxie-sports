/**
 * Embeddings (vetores de significado) pela OpenAI e pela Gemini, sem SDK: a busca por significado da Cosmos (base
 * de conhecimento do assistente) compara o vetor da pergunta com os dos trechos da documentação. A Anthropic e a
 * DeepSeek não têm embeddings próprios.
 *
 * Os vetores saem normalizados (comprimento 1), então a similaridade de cosseno vira o produto escalar.
 */
import { GEMINI_API_BASE } from './providers/gemini.js';
import { callSignal, postJson, type FetchLike } from './http.js';

export const EMBEDDING_PROVIDERS = ['openai', 'gemini'] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

/** Modelo e dimensão de cada provedor (dimensão menor: vetor menor no banco, quase sem perda na busca). */
export const EMBEDDING_MODELS: Record<EmbeddingProvider, { model: string; dimensions: number }> = {
  openai: { model: 'text-embedding-3-small', dimensions: 768 },
  gemini: { model: 'gemini-embedding-001', dimensions: 768 },
};

/** Textos por chamada (a OpenAI aceita 2048 e a Gemini 100 por lote). */
export const EMBEDDING_BATCH = 100;

export interface EmbeddingResult {
  vectors: number[][];
  /** Tokens cobrados (a Gemini não informa: 0). */
  tokens: number;
}

export interface EmbeddingClient {
  readonly provider: EmbeddingProvider;
  readonly model: string;
  readonly dimensions: number;
  embed(
    texts: readonly string[],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<EmbeddingResult>;
}

/** Vetor com comprimento 1 (vetor nulo fica como está). */
export function normalize(v: readonly number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum);
  return len > 0 ? v.map((x) => x / len) : [...v];
}

/** Similaridade de cosseno entre dois vetores normalizados (produto escalar). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

export function createEmbeddingClient(options: {
  provider: EmbeddingProvider;
  apiKey: string;
  fetch?: FetchLike;
  /** Endereço da API (testes). */
  baseUrl?: string;
}): EmbeddingClient {
  const { model, dimensions } = EMBEDDING_MODELS[options.provider];
  const fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  const provider = options.provider;

  async function batch(texts: readonly string[], signal: AbortSignal): Promise<EmbeddingResult> {
    if (provider === 'openai') {
      const res = await postJson(
        fetchImpl,
        `${options.baseUrl ?? 'https://api.openai.com/v1'}/embeddings`,
        { authorization: `Bearer ${options.apiKey}` },
        { model, input: texts, dimensions },
        signal,
        provider,
      );
      const body = (await res.json()) as {
        data?: { index: number; embedding: number[] }[];
        usage?: { prompt_tokens?: number };
      };
      const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
      if (data.length !== texts.length)
        throw new Error(`embeddings: ${data.length} vetores para ${texts.length} textos`);
      return { vectors: data.map((d) => normalize(d.embedding)), tokens: body.usage?.prompt_tokens ?? 0 };
    }
    const res = await postJson(
      fetchImpl,
      `${options.baseUrl ?? GEMINI_API_BASE}/models/${model}:batchEmbedContents`,
      { 'x-goog-api-key': options.apiKey },
      {
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: dimensions,
        })),
      },
      signal,
      provider,
    );
    const body = (await res.json()) as { embeddings?: { values: number[] }[] };
    const embeddings = body.embeddings ?? [];
    if (embeddings.length !== texts.length)
      throw new Error(`embeddings: ${embeddings.length} vetores para ${texts.length} textos`);
    // a Gemini só normaliza a dimensão cheia: com outputDimensionality menor, normaliza aqui
    return { vectors: embeddings.map((e) => normalize(e.values)), tokens: 0 };
  }

  return {
    provider,
    model,
    dimensions,
    async embed(texts, opts = {}) {
      const signal = callSignal(opts.timeoutMs ?? 30_000, opts.signal);
      const out: EmbeddingResult = { vectors: [], tokens: 0 };
      for (let i = 0; i < texts.length; i += EMBEDDING_BATCH) {
        const r = await batch(texts.slice(i, i + EMBEDDING_BATCH), signal);
        out.vectors.push(...r.vectors);
        out.tokens += r.tokens;
      }
      return out;
    },
  };
}
