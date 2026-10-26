/**
 * Orçamento diário de IA compartilhado por TODOS os agentes, em duas medidas:
 * - tokens (AI_DAILY_TOKEN_BUDGET), o teto original;
 * - US$ (AI_DAILY_USD_BUDGET global e AI_AGENT_USD_BUDGETS por agente), somando o custo dos tokens e o
 *   das buscas na web (`cost_usd` de cada linha; o grounding do Gemini é cobrado por consulta).
 * Cada chamada ao LLM vira uma linha em `ops.llm_usage` (fonte da verdade); antes de chamar,
 * `TokenBudget.reserve` soma o consumo do dia UTC e recusa se a estimativa (de uma tentativa) não
 * couber; antes de cada retentativa ou continuação, o provedor confere de novo com o gasto parcial da
 * chamada (`LlmJsonRequest.budgetCheck`). Agente que bate o próprio teto em US$ fica sem IA até a
 * virada do dia UTC (segue com o determinístico). Ligar e desligar é outra chave, literal: AI_STATUS
 * (global) e AI_AGENT_STATUS (por agente), `on`/`off`; desligado, nenhuma chamada sai.
 *
 * Uso por outros agentes: envolva o cliente com `new BudgetedLlmClient(client, budget)` e use
 * `purpose` no formato `<agente>:<detalhe>` (ex.: `live:priorities:2026-10-21`) — o prefixo, sem a
 * versão do prompt (`channels@v1` → `channels`), é a chave do limite por agente (opcional) e das métricas.
 *
 * O limite é "macio" entre processos (a checagem lê o ledger; duas execuções simultâneas podem
 * ultrapassar por no máximo uma chamada cada) — suficiente para conter custo descontrolado.
 */
import { agentOf, type TokenBudget } from '@galaxie/ai-ledger';
import { LlmError } from './errors.js';
import { budgetPriceFor, searchUsdFor } from './pricing.js';
import type { LlmClient, LlmJsonRequest, LlmResult, LlmTier, LlmUsage } from './types.js';

// O ledger (stores, tetos e reserva) vive em @galaxie/ai-ledger, compartilhado com o ingestor.
export {
  MemoryTokenBudgetStore,
  PgTokenBudgetStore,
  TokenBudget,
  agentOf,
  dayUtcOf,
  ledgerPolicy,
  type BudgetPolicy,
  type BudgetStatus,
  type ReservedLimit,
  type TokenBudgetStore,
  type UsageRecord,
  type UsdBudgetStatus,
} from '@galaxie/ai-ledger';

/** `LlmUsage` com o número de buscas na web (campo extra preenchido pelos provedores). */
export type UsageWithSearches = LlmUsage & { webSearchCalls?: number };

/** Overhead aproximado de uma rodada com busca na web (resultados entram como tokens de entrada). */
export const WEB_SEARCH_TOKEN_ESTIMATE = 20_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;

/** Estimativa conservadora de tokens de uma requisição (~4 caracteres por token). */
export function estimateRequestTokens(req: LlmJsonRequest): number {
  const chars =
    req.system.length +
    req.messages.reduce((s, m) => s + m.content.length, 0) +
    JSON.stringify(req.schema).length;
  return (
    Math.ceil(chars / 4) +
    (req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) +
    (req.webSearch ? WEB_SEARCH_TOKEN_ESTIMATE : 0)
  );
}

/** Buscas presumidas numa chamada com busca quando não há teto configurado. */
export const UNCAPPED_SEARCH_ESTIMATE = 10;

/**
 * Estimativa conservadora em US$ de uma requisição: tokens de entrada (com o overhead da busca) e a saída
 * máxima ao preço do modelo, mais o teto de buscas ao preço por busca do provedor. Modelo fora da tabela
 * de preços usa o preço mais caro do provedor (sem provedor conhecido, conta só as buscas).
 */
export function estimateRequestUsd(req: LlmJsonRequest, model: string, provider: string): number {
  const p = budgetPriceFor(model, provider);
  const outputTokens = req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const inputTokens = Math.max(0, estimateRequestTokens(req) - outputTokens);
  const tokensUsd = p ? (inputTokens * p.input + outputTokens * p.output) / 1_000_000 : 0;
  const searches = req.webSearch ? (req.maxSearches ?? UNCAPPED_SEARCH_ESTIMATE) : 0;
  return tokensUsd + searches * searchUsdFor(provider);
}

/** A chamada fez mais buscas que o teto (o Gemini não aplica o teto na API: o alerta é a defesa). */
export function overSearchCap(searches: number, cap: number | null | undefined): boolean {
  return cap !== null && cap !== undefined && searches > cap;
}

/** Decorador de LlmClient que aplica o orçamento e registra o uso de cada chamada. */
export class BudgetedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly budget: TokenBudget,
    private readonly modelOf: (tier: LlmTier) => string = (t) => t,
    private readonly providerName = 'unknown',
  ) {}

  async generateJson<T>(original: LlmJsonRequest): Promise<LlmResult<T>> {
    const agent = agentOf(original.purpose);
    const cap = this.budget.policy.maxSearchesPerCall ?? null;
    // o teto de buscas vai para o provedor (OpenAI e Anthropic aplicam; o Gemini recebe no prompt)
    const req: LlmJsonRequest =
      original.webSearch && original.maxSearches === undefined && cap !== null
        ? { ...original, maxSearches: cap }
        : original;
    const estimate = estimateRequestTokens(req);
    const estimateUsd = estimateRequestUsd(req, req.model ?? this.modelOf(req.tier), this.providerName);
    // faixa da política de execução (#357): manual, a da prioridade da competição ou a fixa do agente
    const band = this.budget.bandOfCall(agent, original.competition);
    const limits = await this.budget.reserve(agent, estimate, estimateUsd, band);
    // a reserva cobre uma tentativa: o provedor confere de novo antes de cada retentativa/continuação
    const call: LlmJsonRequest = {
      ...req,
      budgetCheck: (spent, next) =>
        this.budget.checkPartial(limits, spent, next?.tokens ?? estimate, next?.usd ?? estimateUsd),
    };
    let result: LlmResult<T>;
    try {
      result = await this.inner.generateJson<T>(call);
    } catch (err) {
      const partial = (err as { usage?: UsageWithSearches }).usage;
      await this.budget.record({
        agent,
        purpose: req.purpose,
        provider: this.providerName,
        model: req.model ?? this.modelOf(req.tier),
        tier: req.tier,
        inputTokens: partial?.inputTokens ?? 0,
        outputTokens: partial?.outputTokens ?? 0,
        webSearches: partial?.webSearchCalls ?? 0,
        costUsd: partial?.costUsd,
        outcome: 'error',
        error: err instanceof Error ? err.message : String(err),
        band,
      });
      throw err instanceof LlmError ? err : new LlmError(String(err), 'provider', false, { cause: err });
    }
    const usage = result.usage as UsageWithSearches;
    const searches = usage.webSearchCalls ?? 0;
    const searchCap = req.maxSearches ?? cap;
    // fica no ledger (web_searches): o painel conta as chamadas acima do teto
    if (overSearchCap(searches, searchCap))
      console.warn(
        `[orçamento de IA] ${req.purpose}: ${searches} buscas na web, acima do teto de ${searchCap} por chamada (${result.provider}/${result.model}).`,
      );
    // a chamada já foi paga: falha ao gravar o ledger não descarta o resultado (nem faz o agente pagar de novo)
    try {
      await this.budget.record({
        agent,
        purpose: req.purpose,
        provider: result.provider,
        model: result.model,
        tier: req.tier,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        webSearches: searches,
        costUsd: usage.costUsd,
        outcome: 'ok',
        band,
      });
    } catch (recordErr) {
      console.error(
        `[orçamento de IA] ${req.purpose}: falha ao gravar o uso no ledger (US$ ${usage.costUsd ?? '?'} fora do teto do dia): ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
      );
    }
    return result;
  }
}
