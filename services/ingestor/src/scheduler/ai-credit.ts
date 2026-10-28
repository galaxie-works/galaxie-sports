/**
 * Crédito da conta de IA: a mesma checagem do deploy (infra/vps-telemetry/deploy.sh), feita pelo
 * scheduler dos agentes, que tem a chave. Uma chamada mínima (~20 tokens) ao modelo leve do provedor
 * efetivo, de hora em hora; o resultado vai para ops.runtime_check, aparece no painel de Operação e vira
 * a métrica galaxie_ai_credit_check (alerta AiCreditExhausted). Com a IA desligada (AI_STATUS=off,
 * inclusive pelo painel) não chama o provedor: `warn` com o código `ai_off`.
 *
 * `fail` = a IA está parada até alguém agir: conta sem crédito (402, ou 429/400 com o código ou a mensagem
 * de cota/billing, a mesma regra de services/ai-agents/src/llm/errors.ts) ou chave recusada (401/403).
 * Limite de taxa (429 sem esses sinais), erro do provedor e falha de rede ficam em `warn`.
 */

export type CreditStatus = 'pass' | 'warn' | 'fail';

export interface CreditCheckDetail {
  /** ok | no_key | ai_off | http | network */
  code: 'ok' | 'no_key' | 'ai_off' | 'http' | 'network';
  provider: string;
  model: string;
  /** Status HTTP e código de erro do provedor (ex.: 429 insufficient_quota). */
  http?: number;
  error?: string;
  /** Por que a checagem falhou: sem crédito no provedor ou chave recusada. */
  reason?: 'no_credit' | 'auth';
}

export interface CreditCheckResult {
  status: CreditStatus;
  detail: CreditCheckDetail;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const NO_CREDIT_CODES = ['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached'];
const NO_CREDIT_TEXT =
  /no credits remaining|insufficient_quota|credit balance is too low|exceeded your current quota|prepayment credits are depleted/i;

/** Resposta de erro que deixa a IA parada até alguém recarregar a conta ou trocar a chave. */
function failureReason(http: number, codes: string[], message: string): CreditCheckDetail['reason'] {
  if (http === 401 || http === 403) return 'auth';
  if (http === 402) return 'no_credit';
  if (
    (http === 429 || http === 400) &&
    (codes.some((c) => NO_CREDIT_CODES.includes(c)) || NO_CREDIT_TEXT.test(message))
  )
    return 'no_credit';
  return undefined;
}

const LIGHT_DEFAULT: Record<string, string> = {
  openai: 'gpt-6-luna',
  anthropic: 'claude-haiku-5-5',
  gemini: 'gemini-3.5-flash-lite',
};

const KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export async function checkAiCredit(
  env: NodeJS.ProcessEnv,
  fetchImpl: Fetch = fetch,
  timeoutMs = 20_000,
): Promise<CreditCheckResult> {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || 'openai';
  const model = env.AI_MODEL_LIGHT?.trim() || LIGHT_DEFAULT[provider] || '';
  if (env.AI_STATUS?.trim().toLowerCase() === 'off')
    return { status: 'warn', detail: { code: 'ai_off', provider, model } };
  const key = env[KEY_ENV[provider] ?? 'OPENAI_API_KEY']?.trim();
  if (!key) return { status: 'warn', detail: { code: 'no_key', provider, model } };

  const request: [string, RequestInit] =
    provider === 'gemini'
      ? [
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'ok' }] }],
              generationConfig: { maxOutputTokens: 1 },
            }),
          },
        ]
      : provider === 'anthropic'
        ? [
            'https://api.anthropic.com/v1/messages',
            {
              method: 'POST',
              headers: {
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
            },
          ]
        : [
            'https://api.openai.com/v1/responses',
            {
              method: 'POST',
              headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
              body: JSON.stringify({ model, input: 'ok', max_output_tokens: 16 }),
            },
          ];

  try {
    const res = await fetchImpl(request[0], { ...request[1], signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return { status: 'pass', detail: { code: 'ok', provider, model } };
    // Gemini: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }; OpenAI/Anthropic: code ou type em texto
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string | number; type?: string; status?: string; message?: string };
    };
    const code = typeof body.error?.code === 'string' ? body.error.code : '';
    const error = code || body.error?.type || body.error?.status || '';
    const reason = failureReason(
      res.status,
      [code, body.error?.type ?? ''].filter(Boolean),
      typeof body.error?.message === 'string' ? body.error.message : '',
    );
    return {
      status: reason ? 'fail' : 'warn',
      detail: {
        code: 'http',
        provider,
        model,
        http: res.status,
        ...(error ? { error } : {}),
        ...(reason ? { reason } : {}),
      },
    };
  } catch (err) {
    return {
      status: 'warn',
      detail: {
        code: 'network',
        provider,
        model,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      },
    };
  }
}
