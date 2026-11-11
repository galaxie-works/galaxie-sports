/**
 * Contrato da camada de IA — independente de provedor (OpenAI, Anthropic, Gemini ou DeepSeek).
 * Duas formas de chamar:
 * - `LlmClient.generateJson`: saída JSON validada contra um schema (agentes internos, com busca na web);
 * - `CompletionClient.complete` / `.stream`: texto livre, inteiro ou em pedaços (assistentes, moderação).
 * Quem usa depende só destas interfaces; as implementações ficam em ./providers.
 */

/** Provedores com cliente neste pacote. */
export type LlmProviderId = 'openai' | 'anthropic' | 'gemini' | 'deepseek';
export const LLM_PROVIDER_IDS: readonly LlmProviderId[] = ['openai', 'anthropic', 'gemini', 'deepseek'];

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
  /** Tokens de entrada lidos do cache, quando o provedor informa. */
  cachedInputTokens?: number;
  /** Tokens de entrada gravados no cache, quando o provedor informa (Anthropic). */
  cacheWriteTokens?: number;
  /** Custo estimado em USD, quando a tabela de preços do modelo é conhecida. */
  costUsd?: number;
}

export interface LlmResult<T> {
  data: T;
  citations: LlmCitation[];
  usage: LlmUsage;
  provider: LlmProviderId | 'fake';
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

// ---------------------------------------------------------------------------------------------------
// Texto livre (inteiro ou em streaming)
// ---------------------------------------------------------------------------------------------------

/**
 * Uso de tokens de uma chamada de texto. `inputTokens` é a entrada inteira (inclui os lidos e os gravados
 * no cache); `cachedInputTokens` e `cacheWriteTokens` separam a parte do cache (0 quando o provedor não
 * informa). `costUsd`: estimativa pela tabela de preços (@galaxie/ai-ledger), quando o modelo é conhecido.
 */
export interface CompletionUsage {
  inputTokens: number;
  /** Lidos do cache (OpenAI `cached_tokens`, Anthropic `cache_read_input_tokens`, DeepSeek `prompt_cache_hit_tokens`, Gemini `cachedContentTokenCount`). */
  cachedInputTokens: number;
  /** Gravados no cache (Anthropic `cache_creation_input_tokens`; os demais não cobram à parte: 0). */
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export type CompletionFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'other';

export interface CompletionRequest {
  /** Modelo concreto do provedor (ex.: `deepseek-chat`). */
  model: string;
  /** Instruções de sistema (somadas às mensagens `system` da lista). */
  system?: string;
  messages: LlmMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Pede saída em JSON (modo JSON do provedor, quando existe; o pedido precisa dizer o formato). */
  json?: boolean;
  /**
   * Tempo máximo de cada tentativa (sobrescreve o do cliente). Na resposta inteira, do pedido ao corpo
   * lido; no streaming, do pedido ao último pedaço (o stream inteiro).
   */
  timeoutMs?: number;
  /** Cancela a chamada (ex.: o usuário fechou o chat); cancelada, não é tentada de novo. */
  signal?: AbortSignal;
  /** Identifica a tarefa nos logs e no ledger (ex.: `cosmos:moderation:<tenant>`). */
  purpose?: string;
}

export interface CompletionResult {
  text: string;
  usage: CompletionUsage;
  /** Sempre true numa resposta inteira: o uso é o final da chamada. */
  final: true;
  finishReason: CompletionFinishReason;
  provider: LlmProviderId | 'fake';
  model: string;
}

/**
 * Evento do streaming. `text` traz um pedaço da resposta; `usage` traz o uso acumulado até ali e
 * `final: true` no último evento (com `finishReason`). Sem erro, o stream sempre termina com um `usage`
 * final; o provedor que não informa uso no meio emite só o final.
 */
export type CompletionStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'usage'; usage: CompletionUsage; final: boolean; finishReason?: CompletionFinishReason };

export interface CompletionClient {
  readonly provider: LlmProviderId | 'fake';
  /** Resposta inteira. Lança LlmError (`kind`: auth, rate_limit, quota, timeout, provider, ...). */
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /**
   * Resposta em pedaços. Retentativa só antes do primeiro pedaço (depois, o erro sobe com o uso parcial
   * em `err.usage`, quando houver).
   */
  stream(req: CompletionRequest): AsyncIterable<CompletionStreamEvent>;
}
