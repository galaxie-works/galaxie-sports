/** Erros da camada de IA (mensagens em português; `kind` orienta retry e métricas). */

export type LlmErrorKind =
  'config' | 'provider' | 'rate_limit' | 'timeout' | 'schema' | 'refusal' | 'incomplete' | 'budget';

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}

/** Orçamento diário de tokens esgotado (AI_DAILY_TOKEN_BUDGET) — não é tentado de novo. */
export class BudgetExceededError extends LlmError {
  constructor(
    readonly agent: string,
    readonly used: number,
    readonly limit: number,
    readonly requested: number,
  ) {
    super(
      `Orçamento diário de tokens esgotado (${agent}): usados ${used} de ${limit}, pedido estimado ${requested}.`,
      'budget',
      false,
    );
    this.name = 'BudgetExceededError';
  }
}

/** Status HTTP de erros dos SDKs (OpenAI e Anthropic expõem `status`). */
export function httpStatusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

/** Converte um erro de SDK em LlmError com a decisão de retry. */
export function classifyProviderError(err: unknown, provider: string): LlmError {
  if (err instanceof LlmError) return err;
  const status = httpStatusOf(err);
  const msg = err instanceof Error ? err.message : String(err);
  const name = (err as { name?: string } | null)?.name ?? '';
  if (status === 429)
    return new LlmError(`${provider}: limite de taxa (429).`, 'rate_limit', true, { cause: err });
  if (status === 408 || /timeout|timed out/i.test(name + msg))
    return new LlmError(`${provider}: tempo esgotado.`, 'timeout', true, { cause: err });
  if (status !== undefined && status >= 500)
    return new LlmError(`${provider}: erro do provedor (${status}).`, 'provider', true, { cause: err });
  if (status === undefined && /connection|ECONNRESET|ENOTFOUND|fetch failed|socket/i.test(name + msg))
    return new LlmError(`${provider}: falha de conexão.`, 'provider', true, { cause: err });
  return new LlmError(`${provider}: ${msg}`, 'provider', false, { cause: err });
}
