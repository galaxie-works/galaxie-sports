/** Erros da camada de IA (mensagens em português; `kind` orienta retry e métricas). */

// Os erros do orçamento vivem no ledger compartilhado (@galaxie/ai-ledger): o ingestor (ordem das fotos)
// e os agentes lançam e reconhecem as mesmas classes.
import { LlmError } from '@galaxie/ai-ledger';

export { AiDisabledError, BudgetExceededError, LlmError, type LlmErrorKind } from '@galaxie/ai-ledger';

/** Status HTTP de erros dos SDKs (OpenAI e Anthropic expõem `status`). */
export function httpStatusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

/** Converte um erro de SDK em LlmError com a decisão de retry. */
/**
 * Conta sem crédito no provedor (OpenAI: 429 `insufficient_quota`; Anthropic: "credit balance is too
 * low"). Diferente do limite de taxa: tentar de novo não adianta até alguém recarregar a conta.
 */
function isOutOfCredits(err: unknown, msg: string): boolean {
  const e = err as { code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown } } | null;
  const codes = [e?.code, e?.type, e?.error?.code, e?.error?.type].filter((c) => typeof c === 'string');
  return (
    codes.some((c) =>
      ['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached'].includes(c as string),
    ) ||
    /no credits remaining|insufficient_quota|credit balance is too low|exceeded your current quota|prepayment credits are depleted/i.test(
      msg,
    )
  );
}

export function classifyProviderError(err: unknown, provider: string): LlmError {
  if (err instanceof LlmError) return err;
  const status = httpStatusOf(err);
  const raw = (err as { message?: unknown } | null)?.message;
  const msg = err instanceof Error ? err.message : typeof raw === 'string' ? raw : String(err);
  const name = (err as { name?: string } | null)?.name ?? '';
  if ((status === 429 || status === 400 || status === 402) && isOutOfCredits(err, msg))
    return new LlmError(
      `${provider}: conta sem crédito (recarregue o saldo no painel do provedor).`,
      'quota',
      false,
      { cause: err },
    );
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
