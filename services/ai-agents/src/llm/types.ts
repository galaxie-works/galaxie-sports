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
  /**
   * Teto de buscas na web desta chamada. O orçamento (BudgetedLlmClient) preenche com
   * AI_MAX_SEARCHES_PER_CALL quando ausente. OpenAI e Anthropic aplicam na API; o Gemini não tem o
   * parâmetro e recebe o teto como instrução (a contagem real é conferida depois da chamada).
   */
  maxSearches?: number;
  /** Restringe a busca a estes domínios, quando o provedor suportar. */
  allowedDomains?: string[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Identifica a tarefa no orçamento de tokens e nos logs (ex.: "wtw:event:<id>:BR"). */
  purpose: string;
  /**
   * Competição da chamada: a prioridade dela (P0 futebol LATAM, P1, resto) escolhe a faixa de orçamento
   * dos agentes `priority` de config/ai-policy.yaml. Ausente: a faixa `rest`.
   */
  competition?: { sport?: string | null; slug: string } | null;
  /**
   * Preenchido pelo orçamento (BudgetedLlmClient), que reserva uma tentativa só. O provedor chama antes
   * de cada nova tentativa e de cada continuação, com o gasto parcial da chamada (tokens e US$ já
   * cobrados); lança BudgetExceededError se mais uma rodada estimada não couber no teto do dia. `next`:
   * estimativa da próxima rodada quando ela é menor que o pedido inteiro (ex.: só o passo 2 do Gemini);
   * ausente, vale a estimativa da reserva.
   */
  budgetCheck?: (spent: { tokens: number; usd: number }, next?: { tokens: number; usd: number }) => void;
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

/** O que a última recusa do orçamento pedia: uma chamada assim cabe agora? */
export interface BudgetNeed {
  unit: 'tokens' | 'usd';
  /** Estimativa da chamada recusada (tokens ou US$, conforme `unit`). */
  requested: number;
}

export interface LlmClient {
  generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>>;
  /**
   * Opcional (o cliente com orçamento): uma chamada do agente, para esta competição e com esta
   * estimativa, caberia agora nos tetos (faixa, agente, global)? Não chama o provedor nem grava nada.
   */
  hasRoom?(agent: string, competition: LlmJsonRequest['competition'], need?: BudgetNeed): Promise<boolean>;
}
