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
import { and, count, eq, gt, gte, sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { ledger, reservation } from '@galaxie/db/schema';
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
import { activeFunction, getWallet, release, reserve, settle, utcDayStart } from './wallet.js';

/** Prazo da reserva: maior que o tempo máximo da chamada, com folga para o acerto. */
export const BRANDBOOK_RESERVATION_TTL_SECONDS = 300;
/**
 * Tempo máximo da leitura do PDF no provedor. Uma tentativa só (sem repetição automática): repetir reenviaria até
 * ~27 MB e poderia passar do prazo da reserva, com o provedor cobrando cada tentativa.
 */
export const BRANDBOOK_TIMEOUT_MS = 150_000;

/** Limites da leitura de brandbook. Fora daqui, nada; ajustar é mudar estes números. */
export const BRANDBOOK_LIMITS = {
  /** Leituras em andamento por pessoa. */
  userConcurrent: 1,
  /** Leituras por pessoa por hora. */
  userPerHour: 5,
  /** Leituras por tenant por hora (todas as pessoas). */
  tenantPerHour: 15,
  /** Leituras sem tema (não era um manual) por tenant no dia: a Galaxie paga essas, então o número é baixo. */
  tenantWaivedPerDay: 3,
  /** Parte do teto diário de segurança da Cosmos que um tenant pode gastar sozinho em brandbooks. */
  tenantDailyShare: 0.1,
} as const;

export const providerReadsPdf = (provider: CosmosProvider) =>
  (BRANDBOOK_PROVIDERS as readonly string[]).includes(provider);

export interface BrandbookQuote {
  credits: number;
  pages: number;
  provider: CosmosProvider;
  model: string;
}

export type BrandbookErrorCode =
  | 'unavailable'
  | 'disabled'
  | 'blocked'
  | 'insufficient'
  | 'no_wallet'
  | 'unreadable'
  | 'failed'
  | 'busy'
  | 'rate_limited'
  | 'tenant_limit';

/**
 * Limites de uso antes de reservar; null = pode ler. Contam as reservas (inclusive as que voltaram) e, à parte, as
 * leituras sem tema do dia, que a Galaxie paga: sem isso, PDFs que não são manuais sairiam de graça sem fim e um
 * tenant sozinho podia bater o teto diário da Cosmos de todos.
 */
export async function brandbookLimitError(
  db: Database,
  input: { tenantId: string; userId: string; settings: CosmosSettings },
  now: Date = new Date(),
): Promise<BrandbookErrorCode | null> {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayStart = utcDayStart(now);
  const mine = and(
    eq(reservation.tenantId, input.tenantId),
    eq(reservation.functionName, BRANDBOOK_FUNCTION),
  );
  const usage = and(
    eq(ledger.tenantId, input.tenantId),
    eq(ledger.kind, 'usage'),
    eq(ledger.functionName, BRANDBOOK_FUNCTION),
    gte(ledger.createdAt, dayStart),
  );
  const [[open], [tenantOpen], [userHour], [tenantHour], [today]] = await Promise.all([
    db
      .select({ n: count() })
      .from(reservation)
      .where(
        and(
          mine,
          eq(reservation.userId, input.userId),
          eq(reservation.status, 'open'),
          gt(reservation.expiresAt, now),
        ),
      ),
    db
      .select({ n: count() })
      .from(reservation)
      .where(and(mine, eq(reservation.status, 'open'), gt(reservation.expiresAt, now))),
    db
      .select({ n: count() })
      .from(reservation)
      .where(and(mine, eq(reservation.userId, input.userId), gte(reservation.createdAt, hourAgo))),
    db
      .select({ n: count() })
      .from(reservation)
      .where(and(mine, gte(reservation.createdAt, hourAgo))),
    db
      .select({
        waived: sql<number>`count(*) filter (where ${ledger.credits} = 0)`.mapWith(Number),
        usd: sql<string>`coalesce(sum(${ledger.costUsd}), 0)`,
      })
      .from(ledger)
      .where(usage),
  ]);
  if ((open?.n ?? 0) >= BRANDBOOK_LIMITS.userConcurrent) return 'busy';
  if ((userHour?.n ?? 0) >= BRANDBOOK_LIMITS.userPerHour) return 'rate_limited';
  if ((tenantHour?.n ?? 0) >= BRANDBOOK_LIMITS.tenantPerHour) return 'rate_limited';
  // leitura em andamento pode terminar sem tema: conta como sem tema até acertar, para leituras ao mesmo tempo não
  // passarem juntas do teto
  if ((today?.waived ?? 0) + (tenantOpen?.n ?? 0) >= BRANDBOOK_LIMITS.tenantWaivedPerDay)
    return 'rate_limited';
  const ceiling = input.settings.dailyUsdCeiling;
  if (
    ceiling !== null &&
    ceiling > 0 &&
    Number(today?.usd ?? 0) >= ceiling * BRANDBOOK_LIMITS.tenantDailyShare
  )
    return 'tenant_limit';
  return null;
}

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
  | { ok: false; error: BrandbookErrorCode; notes?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    /** Esperas entre as tentativas do acerto (testes usam valores curtos). */
    settleBackoffMs?: number[];
  },
  env: Record<string, string | undefined> = process.env,
): Promise<BrandbookRunResult> {
  const { quote } = input;
  const apiKey = cosmosApiKey(quote.provider, env);
  if (!input.client && !apiKey) return { ok: false, error: 'unavailable' };
  let reservation: { id: string; credits: number };
  try {
    // limites e reserva na mesma transação, com trava por tenant: duas leituras ao mesmo tempo não veem as mesmas
    // contagens e passam juntas dos limites
    const reserved = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`cosmos.brandbook:${input.tenantId}`}, 0))`,
      );
      const locked = tx as unknown as Database;
      const limited = await brandbookLimitError(locked, input);
      if (limited) return { limited };
      return {
        reservation: await reserve(
          locked,
          {
            tenantId: input.tenantId,
            functionName: BRANDBOOK_FUNCTION,
            estimatedCredits: quote.credits,
            scope: 'builder.theme',
            userId: input.userId,
            ttlSeconds: BRANDBOOK_RESERVATION_TTL_SECONDS,
          },
          { settings: input.settings },
        ),
      };
    });
    if ('limited' in reserved) return { ok: false, error: reserved.limited! };
    reservation = reserved.reservation;
  } catch (err) {
    if (isCosmosError(err)) return { ok: false, error: RESERVE_ERRORS[err.code] ?? 'unavailable' };
    throw err;
  }

  const client =
    input.client ??
    createCompletionClient(quote.provider, {
      apiKey: apiKey!,
      maxRetries: 0,
      timeoutMs: BRANDBOOK_TIMEOUT_MS,
    });
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
      // sem `temperature`: os modelos atuais da Anthropic e os de raciocínio da OpenAI recusam valor fora do padrão,
      // e a resposta é validada campo a campo de qualquer jeito
      maxOutputTokens: BRANDBOOK_MAX_OUTPUT_TOKENS,
      timeoutMs: BRANDBOOK_TIMEOUT_MS,
      purpose: `cosmos:brandbook:${input.tenantId}`,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (err) {
    // sem a contagem do provedor, a reserva volta inteira; um corte no meio (navegador fechado) pode ter sido cobrado
    // pelo provedor e não aparece no extrato: perda aceita, rara e limitada por uma leitura por vez por pessoa
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
  // o provedor já cobrou: o acerto tenta de novo antes de desistir, e o tema montado é entregue mesmo se o acerto
  // falhar de vez (fica no log para conciliação, como no assistente)
  const backoff = input.settleBackoffMs ?? [200, 800];
  let charged = 0;
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    try {
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
      charged = settled.charged;
      break;
    } catch (err) {
      if (isCosmosError(err, 'reservation_closed') || attempt === backoff.length) {
        console.error('[cosmos] acerto do brandbook falhou; fica para conciliação', {
          reservationId: reservation.id,
          tenantId: input.tenantId,
          costUsd,
          err,
        });
        break;
      }
      await sleep(backoff[attempt]!);
    }
  }
  if (!usable) return { ok: false, error: 'unreadable', ...(extract?.notes ? { notes: extract.notes } : {}) };
  return { ok: true, extract, themes: buildBrandbookThemes(extract), charged };
}
