/**
 * "Testar antes de salvar" (#1087): uma chamada barata ao provedor com a chave candidata, feita no servidor, com prazo
 * curto. Nada é gravado e o valor nunca vai para log, resposta ou mensagem de erro: o resultado é só ok, recusada ou
 * fora do ar. Cada chamada escolhida não gasta cota paga (ou gasta o mínimo):
 *
 * - api-sports: `GET /status` (não conta na cota do dia);
 * - OpenAI, Anthropic, DeepSeek, Gemini: listar modelos;
 * - YouTube: `videos.list` de um vídeo com `part=id` (1 unidade da cota; a busca custaria 100);
 * - Stripe: `GET /v1/balance`.
 *
 * As chaves vão sempre em cabeçalho (nunca na URL, que pode parar em log de proxy).
 */

import { API_KEY_HEADER, API_STATUS_URL } from '@galaxie/apisports-client/hosts';

export type SecretTestResult = 'ok' | 'rejected' | 'unreachable';

interface ProviderTest {
  url: string;
  headers: (value: string) => Record<string, string>;
  /** Corpo 200 que ainda assim é recusa (a api-sports responde 200 com `errors`). */
  bodyRejects?: (body: unknown) => boolean;
}

const bearer = (value: string) => ({ authorization: `Bearer ${value}` });
const google = (value: string) => ({ 'x-goog-api-key': value });

const PROVIDER_TESTS: Readonly<Record<string, ProviderTest>> = {
  APISPORTS_KEY: {
    url: API_STATUS_URL,
    headers: (value) => ({ [API_KEY_HEADER]: value }),
    bodyRejects: (body) => {
      const errors = (body as { errors?: unknown } | null)?.errors;
      return Array.isArray(errors) ? errors.length > 0 : Boolean(errors && Object.keys(errors).length);
    },
  },
  OPENAI_API_KEY: { url: 'https://api.openai.com/v1/models', headers: bearer },
  COSMOS_OPENAI_API_KEY: { url: 'https://api.openai.com/v1/models', headers: bearer },
  ANTHROPIC_API_KEY: {
    url: 'https://api.anthropic.com/v1/models?limit=1',
    headers: (value) => ({ 'x-api-key': value, 'anthropic-version': '2023-06-01' }),
  },
  GEMINI_API_KEY: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    headers: google,
  },
  DEEPSEEK_API_KEY: { url: 'https://api.deepseek.com/models', headers: bearer },
  YOUTUBE_API_KEY: {
    url: 'https://www.googleapis.com/youtube/v3/videos?part=id&id=jNQXAC9IVRw',
    headers: google,
  },
  STRIPE_SECRET_KEY: { url: 'https://api.stripe.com/v1/balance', headers: bearer },
};
// as chaves da Cosmos testam no mesmo provedor que as internas
const COSMOS_ALIASES: Readonly<Record<string, string>> = {
  COSMOS_ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  COSMOS_GEMINI_API_KEY: 'GEMINI_API_KEY',
  COSMOS_DEEPSEEK_API_KEY: 'DEEPSEEK_API_KEY',
};

const providerTest = (key: string): ProviderTest | undefined =>
  PROVIDER_TESTS[key] ?? (COSMOS_ALIASES[key] ? PROVIDER_TESTS[COSMOS_ALIASES[key]] : undefined);

/** A chave tem "Testar antes de salvar". */
export const isTestableSecret = (key: string): boolean => providerTest(key) !== undefined;

export const SECRET_TEST_TIMEOUT_MS = 8_000;

/**
 * Testa a chave candidata no provedor. 401/403 (ou o corpo de recusa) = recusada; prazo estourado, rede ou 5xx = fora do
 * ar. Chave sem teste devolve `null`.
 */
export async function testSecretValue(
  key: string,
  value: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = SECRET_TEST_TIMEOUT_MS,
): Promise<SecretTestResult | null> {
  const test = providerTest(key);
  if (!test) return null;
  let response: Response;
  try {
    response = await fetchImpl(test.url, {
      headers: { accept: 'application/json', ...test.headers(value) },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    return 'unreachable';
  }
  if (response.status === 401 || response.status === 403) return 'rejected';
  // chave do Google inválida responde 400 (API_KEY_INVALID)
  if (response.status === 400) return 'rejected';
  if (!response.ok) return 'unreachable';
  if (test.bodyRejects) {
    const body: unknown = await response.json().catch(() => null);
    if (test.bodyRejects(body)) return 'rejected';
  }
  return 'ok';
}
