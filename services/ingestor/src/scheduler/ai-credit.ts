/**
 * Crédito da conta de IA: a mesma checagem do deploy (infra/vps-telemetry/deploy.sh), feita pelo
 * scheduler dos agentes, que tem a chave. Uma chamada mínima (~20 tokens) ao modelo leve do provedor
 * efetivo; o resultado vai para ops.runtime_check e aparece no painel de Operação.
 */

export type CreditStatus = 'pass' | 'warn' | 'fail';

export interface CreditCheckDetail {
  /** ok | no_key | http | network */
  code: 'ok' | 'no_key' | 'http' | 'network';
  provider: string;
  model: string;
  /** Status HTTP e código de erro do provedor (ex.: 429 insufficient_quota). */
  http?: number;
  error?: string;
}

export interface CreditCheckResult {
  status: CreditStatus;
  detail: CreditCheckDetail;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

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
      error?: { code?: string | number; type?: string; status?: string };
    };
    const code = typeof body.error?.code === 'string' ? body.error.code : '';
    const error = code || body.error?.type || body.error?.status || '';
    return {
      status: 'warn',
      detail: { code: 'http', provider, model, http: res.status, ...(error ? { error } : {}) },
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
