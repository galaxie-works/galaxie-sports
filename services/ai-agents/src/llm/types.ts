/**
 * Contrato da camada de IA — independente de provedor (OpenAI, Anthropic ou Gemini, escolhido por AI_PROVIDER).
 * Todo agente depende só desta interface; as implementações ficam em ./providers e os testes usam um cliente falso.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Níveis de modelo (mapeados por variável de ambiente para modelos concretos de cada provedor):
 * - `light`: classificação, priorização, microcopy (barato e rápido);
 * - `standard`: redação de cenário/resumo a partir de fatos;
 * - `research`: pesquisa com busca na web (onde assistir, curadoria).
 */
export type LlmTier = 'light' | 'standard' | 'research';

export interface LlmJsonRequest {
  tier: LlmTier;
  /** Sobrescreve o modelo do nível (raro; prefira configurar por ambiente). */
  model?: string;
  system: string;
  messages: LlmMessage[];
  /** JSON Schema da saída esperada — a resposta é validada contra ele. */
  schema: Record<string, unknown>;
  schemaName: string;
  /** Habilita a ferramenta de busca na web do provedor. */
  webSearch?: boolean;
  /** Restringe a busca a estes domínios, quando o provedor suportar. */
  allowedDomains?: string[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Identifica a tarefa no orçamento de tokens e nos logs (ex.: "wtw:event:<id>:BR"). */
  purpose: string;
}

export interface LlmCitation {
  url: string;
  title?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Custo estimado em USD, quando a tabela de preços do modelo é conhecida. */
  costUsd?: number;
}

export interface LlmResult<T> {
  data: T;
  citations: LlmCitation[];
  usage: LlmUsage;
  provider: 'openai' | 'anthropic' | 'gemini' | 'fake';
  model: string;
  /**
   * URLs que vieram da busca do provedor (grounding), quando ele as garante: o pedido em dois passos do
   * Gemini. Quem consome evidências descarta qualquer URL fora desta lista. Ausente = sem garantia.
   */
  groundedUrls?: string[];
}

export interface LlmClient {
  generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>>;
}
