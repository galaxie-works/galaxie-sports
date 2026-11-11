/**
 * Leitura de um brandbook do começo ao fim (#1004), fora do Next para testar com banco: reserva, chamada ao provedor
 * com o PDF anexado, leitura da resposta e acerto. Regras de cobrança, as mesmas do assistente:
 *
 * - Sem reserva, nenhuma chamada ao provedor.
 * - Provedor falhou: a reserva volta inteira.
 * - Resposta que não vira tema (fora do formato, ou o PDF não era um manual de marca): fecha sem cobrar, mas o custo
 *   real vai para o extrato (o provedor cobrou e o teto do dia conta).
 * - Tema montado: acerta pelo custo real, nunca acima da reserva (o "cerca de N créditos" que o cliente viu).
 */
import type { Database } from '@galaxie/db/client';
import { estimateCostUsd } from '@galaxie/ai-ledger/pricing';
import { createCompletionClient, type CompletionClient } from '@galaxie/llm';
import {
  BRANDBOOK_FUNCTION,
  BRANDBOOK_MAX_OUTPUT_TOKENS,
  BRANDBOOK_PROVIDERS,
  brandbookPrompt,
  brandbookTokens,
  buildBrandbookThemes,
  estimatePdfPages,
  parseBrandbookResult,
  type BrandbookExtract,
  type BrandbookThemes,
} from './brandbook.js';
import { creditsFor } from './credits.js';
import { isCosmosError } from './errors.js';
import { cosmosApiKey, type CosmosProvider } from './models.js';
import type { CosmosSettings } from './settings.js';
import { activeFunction, getWallet, release, reserve, settle } from './wallet.js';

/** Prazo da reserva: maior que o tempo máximo da chamada. */
export const BRANDBOOK_RESERVATION_TTL_SECONDS = 300;
/** Tempo máximo da leitura do PDF no provedor. */
export const BRANDBOOK_TIMEOUT_MS = 150_000;

export const providerReadsPdf = (provider: CosmosProvider) =>
  (BRANDBOOK_PROVIDERS as readonly string[]).includes(provider);

export interface BrandbookQuote {
  credits: number;
  pages: number;
  provider: CosmosProvider;
  model: string;
}

export type BrandbookErrorCode =
  'unavailable' | 'disabled' | 'blocked' | 'insufficient' | 'no_wallet' | 'unreadable' | 'failed';

/**
 * Custo estimado da leitura (mínimo da função, que começa em 60 créditos): páginas do PDF pelo preço do modelo da
 * função. null quando a função está fora do catálogo, desligada, num provedor que não lê PDF ou sem a chave da Cosmos.
 */
export async function quoteBrandbook(
  db: Database,
  input: { tenantId: string; pdf: Uint8Array; settings: CosmosSettings },
  env: Record<string, string | undefined> = process.env,
): Promise<BrandbookQuote | null> {
  const [fn, wallet] = await Promise.all([
    activeFunction(db, BRANDBOOK_FUNCTION),
    getWallet(db, input.tenantId),
  ]);
  if (!fn || !providerReadsPdf(fn.provider) || !cosmosApiKey(fn.provider, env)) return null;
  const pages = estimatePdfPages(input.pdf);
  const costUsd = estimateCostUsd(fn.model, brandbookTokens(pages));
  const credits = creditsFor({
    costUsd,
    multiplier: wallet?.multiplier ?? 1,
    creditUsd: input.settings.creditUsd,
    minCredits: fn.minCredits,
  });
  return { credits, pages, provider: fn.provider, model: fn.model };
}

export type BrandbookRunResult =
  | { ok: true; extract: BrandbookExtract; themes: BrandbookThemes; charged: number }
  | { ok: false; error: BrandbookErrorCode };

const RESERVE_ERRORS: Record<string, BrandbookErrorCode> = {
  cosmos_disabled: 'disabled',
  wallet_blocked: 'blocked',
  insufficient_credits: 'insufficient',
  no_wallet: 'no_wallet',
};

/**
 * Lê o brandbook e monta os temas. `quote` é a estimativa que o cliente confirmou (a reserva pede esse valor);
 * `client` só nos testes.
 */
export async function runBrandbook(
  db: Database,
  input: {
    tenantId: string;
    userId: string;
    pdf: Uint8Array;
    fileName?: string;
    locale: string;
    quote: BrandbookQuote;
    settings: CosmosSettings;
    client?: CompletionClient;
    signal?: AbortSignal;
  },
  env: Record<string, string | undefined> = process.env,
): Promise<BrandbookRunResult> {
  const { quote } = input;
  const apiKey = cosmosApiKey(quote.provider, env);
  if (!input.client && !apiKey) return { ok: false, error: 'unavailable' };
  let reservation: { id: string; credits: number };
  try {
    reservation = await reserve(
      db,
      {
        tenantId: input.tenantId,
        functionName: BRANDBOOK_FUNCTION,
        estimatedCredits: quote.credits,
        scope: 'builder.theme',
        userId: input.userId,
        ttlSeconds: BRANDBOOK_RESERVATION_TTL_SECONDS,
      },
      { settings: input.settings },
    );
  } catch (err) {
    if (isCosmosError(err)) return { ok: false, error: RESERVE_ERRORS[err.code] ?? 'unavailable' };
    throw err;
  }

  const client = input.client ?? createCompletionClient(quote.provider, { apiKey: apiKey! });
  const prompt = brandbookPrompt(input.locale);
  let result;
  try {
    result = await client.complete({
      model: quote.model,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.message }],
      attachments: [
        {
          mediaType: 'application/pdf',
          data: Buffer.from(input.pdf).toString('base64'),
          name: input.fileName ?? 'brandbook.pdf',
        },
      ],
      maxOutputTokens: BRANDBOOK_MAX_OUTPUT_TOKENS,
      temperature: 0,
      timeoutMs: BRANDBOOK_TIMEOUT_MS,
      purpose: `cosmos:brandbook:${input.tenantId}`,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (err) {
    await release(db, { tenantId: input.tenantId, reservationId: reservation.id }).catch((e) =>
      console.error('[cosmos] reserva do brandbook não voltou', e),
    );
    console.error('[cosmos] leitura do brandbook falhou', err);
    return { ok: false, error: 'failed' };
  }

  const costUsd = estimateCostUsd(quote.model, {
    inputTokens: result.usage.inputTokens,
    cachedInputTokens: result.usage.cachedInputTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    outputTokens: result.usage.outputTokens,
  });
  const extract = parseBrandbookResult(result.text);
  const usable = extract !== null && extract.colors.length > 0;
  const settled = await settle(db, {
    tenantId: input.tenantId,
    reservationId: reservation.id,
    costUsd,
    maxCredits: reservation.credits,
    tokensIn: result.usage.inputTokens,
    tokensCached: result.usage.cachedInputTokens,
    tokensOut: result.usage.outputTokens,
    model: quote.model,
    ...(usable ? {} : { waive: true }),
    metadata: { kind: 'brandbook', pages: quote.pages, usable },
  });
  if (!usable) return { ok: false, error: 'unreadable' };
  return { ok: true, extract, themes: buildBrandbookThemes(extract), charged: settled.charged };
}
