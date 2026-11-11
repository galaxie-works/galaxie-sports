/**
 * Uma pergunta ao assistente da Cosmos do começo ao fim (#1003), fora do Next para testar com banco: limites de uso,
 * reserva, resposta em fluxo e acerto. Regras de cobrança:
 *
 * - Sem reserva, nenhuma chamada ao provedor.
 * - Nada entregue (falha ou desistência antes do primeiro pedaço): a reserva volta inteira.
 * - Algo entregue (fim normal, falha no meio, "Parar" ou o navegador fechou): acerta pelo que foi usado, com os
 *   tokens do provedor ou, sem eles, estimados pelo texto já mandado. Nunca devolve a reserva depois de entregar.
 * - O acerto nunca passa da reserva: o cliente nunca paga mais que o "cerca de N créditos" que viu.
 * - Acerto que falha é repetido; se ainda falhar, vai para o log de erro para conciliação (a reserva vence no prazo
 *   dela, que é maior que a duração máxima da rota).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db/client';
import { ledger, reservation } from '@galaxie/db/schema';
import {
  approxTokens,
  ASSISTANT_FUNCTION,
  ASSISTANT_MODEL,
  assistantCostUsd,
  type AssistantPrompt,
  type ChatTurn,
  type StreamUsage,
} from './assistant.js';
import { isCosmosError } from './errors.js';
import type { CosmosSettings } from './settings.js';
import { getWallet, release, reserve, settle, utcDayStart } from './wallet.js';

/** Limites do assistente. Fora daqui, nada; ajustar é mudar estes números. */
export const ASSISTANT_LIMITS = {
  /** Perguntas em andamento por pessoa. */
  userConcurrent: 1,
  /** Perguntas por pessoa por minuto. */
  userPerMinute: 10,
  /** Perguntas por tenant por minuto (todas as pessoas). */
  tenantPerMinute: 60,
  /** Parte do teto diário de segurança da Cosmos que um tenant pode gastar sozinho no assistente. */
  tenantDailyShare: 0.25,
} as const;

/** Prazo da reserva: maior que a duração máxima da rota, para o job de limpeza nunca devolver uma pergunta viva. */
export const ASSISTANT_RESERVATION_TTL_SECONDS = 300;

export type AssistantErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'unavailable'
  | 'module'
  | 'staff'
  | 'disabled'
  | 'blocked'
  | 'insufficient'
  | 'no_wallet'
  | 'busy'
  | 'rate_limited'
  | 'tenant_limit'
  | 'failed';

export type AssistantEvent =
  | { type: 'start'; reserved: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; charged: number; available: number; sig?: string }
  | { type: 'error'; code: AssistantErrorCode };

const RESERVE_ERRORS: Record<string, AssistantErrorCode> = {
  insufficient_credits: 'insufficient',
  wallet_blocked: 'blocked',
  cosmos_disabled: 'disabled',
  no_wallet: 'no_wallet',
  unknown_function: 'unavailable',
  safety_ceiling: 'unavailable',
};

/** Limites de uso antes de reservar; null = pode perguntar. */
export async function assistantLimitError(
  db: Database,
  input: { tenantId: string; userId: string; settings: CosmosSettings },
  now: Date = new Date(),
): Promise<AssistantErrorCode | null> {
  const minuteAgo = new Date(now.getTime() - 60_000);
  const mine = and(
    eq(reservation.tenantId, input.tenantId),
    eq(reservation.functionName, ASSISTANT_FUNCTION),
  );
  const [[open], [userMinute], [tenantMinute]] = await Promise.all([
    db
      .select({ n: count() })
      .from(reservation)
      .where(and(mine, eq(reservation.userId, input.userId), eq(reservation.status, 'open'))),
    db
      .select({ n: count() })
      .from(reservation)
      .where(and(mine, eq(reservation.userId, input.userId), gte(reservation.createdAt, minuteAgo))),
    db
      .select({ n: count() })
      .from(reservation)
      .where(and(mine, gte(reservation.createdAt, minuteAgo))),
  ]);
  if ((open?.n ?? 0) >= ASSISTANT_LIMITS.userConcurrent) return 'busy';
  if ((userMinute?.n ?? 0) >= ASSISTANT_LIMITS.userPerMinute) return 'rate_limited';
  if ((tenantMinute?.n ?? 0) >= ASSISTANT_LIMITS.tenantPerMinute) return 'rate_limited';
  const ceiling = input.settings.dailyUsdCeiling;
  if (ceiling !== null && ceiling > 0) {
    const [row] = await db
      .select({ usd: sql<string>`coalesce(sum(${ledger.costUsd}), 0)` })
      .from(ledger)
      .where(
        and(
          eq(ledger.tenantId, input.tenantId),
          eq(ledger.kind, 'usage'),
          eq(ledger.functionName, ASSISTANT_FUNCTION),
          gte(ledger.createdAt, utcDayStart(now)),
        ),
      );
    if (Number(row?.usd ?? 0) >= ceiling * ASSISTANT_LIMITS.tenantDailyShare) return 'tenant_limit';
  }
  return null;
}

// ── histórico assinado: o navegador só devolve como "resposta da Cosmos" o que o servidor mandou ──

const turnSig = (key: string, scope: { tenantId: string; userId: string }, text: string) =>
  createHmac('sha256', key).update(`${scope.tenantId}\n${scope.userId}\n${text}`).digest('base64url');

/** Assinatura de uma resposta, mandada no evento `done`. */
export const signAssistantTurn = turnSig;

/**
 * Histórico que vai para o prompt: as perguntas da pessoa e só as respostas com assinatura válida (uma resposta
 * inventada no navegador viraria instrução da "Cosmos"). Sem chave, nenhuma resposta entra.
 */
export function verifiedHistory(
  history: readonly (ChatTurn & { sig?: string })[],
  key: string | null,
  scope: { tenantId: string; userId: string },
): ChatTurn[] {
  return history.flatMap((t): ChatTurn[] => {
    if (t.role === 'user') return [{ role: t.role, text: t.text }];
    if (!key || !t.sig) return [];
    const want = Buffer.from(turnSig(key, scope, t.text));
    const got = Buffer.from(t.sig);
    return want.length === got.length && timingSafeEqual(want, got) ? [{ role: t.role, text: t.text }] : [];
  });
}

export interface AskInput {
  tenantId: string;
  userId: string;
  route: string;
  prompt: AssistantPrompt;
  credits: number;
  settings: CosmosSettings;
  /** Chave para assinar a resposta (histórico); sem chave, a resposta sai sem assinatura. */
  signingKey?: string | null;
}

export interface AskDeps {
  /** Chamada ao provedor em fluxo; preenche `usage` com os tokens reais. */
  stream: (signal: AbortSignal, usage: StreamUsage) => AsyncIterable<string>;
  /** Desistência: o navegador fechou ou a pessoa clicou em "Parar". */
  signal?: AbortSignal;
  now?: () => Date;
  /** Esperas entre as tentativas do acerto (ms). */
  settleBackoffMs?: readonly number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Perguntas abertas da pessoa no assistente (a de agora inclusa). */
async function openAsks(db: Database, tenantId: string, userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(reservation)
    .where(
      and(
        eq(reservation.tenantId, tenantId),
        eq(reservation.functionName, ASSISTANT_FUNCTION),
        eq(reservation.userId, userId),
        eq(reservation.status, 'open'),
      ),
    );
  return row?.n ?? 0;
}

export async function* askAssistant(
  db: Database,
  input: AskInput,
  deps: AskDeps,
): AsyncGenerator<AssistantEvent> {
  const now = deps.now ?? (() => new Date());
  const limited = await assistantLimitError(db, input, now());
  if (limited) {
    yield { type: 'error', code: limited };
    return;
  }

  let reservationId: string;
  let reserved: number;
  try {
    const r = await reserve(
      db,
      {
        tenantId: input.tenantId,
        functionName: ASSISTANT_FUNCTION,
        estimatedCredits: input.credits,
        scope: 'assistant',
        userId: input.userId,
        ttlSeconds: ASSISTANT_RESERVATION_TTL_SECONDS,
      },
      { settings: input.settings, now: now() },
    );
    reservationId = r.id;
    reserved = r.credits;
  } catch (err) {
    if (isCosmosError(err)) {
      yield { type: 'error', code: RESERVE_ERRORS[err.code] ?? 'failed' };
      return;
    }
    throw err;
  }

  // duas perguntas da mesma pessoa passaram juntas pela conferência: fica a primeira
  if ((await openAsks(db, input.tenantId, input.userId)) > ASSISTANT_LIMITS.userConcurrent) {
    await release(db, { tenantId: input.tenantId, reservationId }).catch(() => {});
    yield { type: 'error', code: 'busy' };
    return;
  }

  yield { type: 'start', reserved };

  const usage: StreamUsage = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  deps.signal?.addEventListener('abort', onAbort, { once: true });
  if (deps.signal?.aborted) controller.abort();
  let text = '';
  let failed = false;
  try {
    for await (const piece of deps.stream(controller.signal, usage)) {
      text += piece;
      yield { type: 'delta', text: piece };
    }
  } catch (err) {
    failed = true;
    if (!controller.signal.aborted) console.error('[cosmos] assistente falhou no provedor', err);
  } finally {
    deps.signal?.removeEventListener('abort', onAbort);
  }

  // nada entregue: devolve tudo
  if (!text) {
    await release(db, { tenantId: input.tenantId, reservationId }).catch((err) =>
      console.error('[cosmos] reserva do assistente não voltou', { reservationId, err }),
    );
    yield { type: 'error', code: 'failed' };
    return;
  }

  // entregue (inteiro ou em parte): acerta pelo usado, sem passar da reserva
  if (usage.outputTokens < approxTokens(text)) usage.outputTokens = approxTokens(text);
  const backoff = deps.settleBackoffMs ?? [200, 800];
  let settled: { charged: number; available: number } | null = null;
  for (let attempt = 0; attempt <= backoff.length && !settled; attempt++) {
    try {
      const r = await settle(
        db,
        {
          tenantId: input.tenantId,
          reservationId,
          costUsd: assistantCostUsd(usage),
          maxCredits: reserved,
          tokensIn: usage.inputTokens,
          tokensCached: usage.cachedInputTokens,
          tokensOut: usage.outputTokens,
          model: ASSISTANT_MODEL,
          metadata: {
            route: input.route,
            ...(failed ? { partial: true } : {}),
            ...(usage.cacheWriteTokens ? { cache_write_tokens: usage.cacheWriteTokens } : {}),
          },
        },
        { now: now() },
      );
      settled = { charged: r.charged, available: r.available };
    } catch (err) {
      // reserva já fechada (vencida ou devolvida) não volta a abrir: repetir não adianta
      if (isCosmosError(err, 'reservation_closed') || attempt === backoff.length) {
        console.error('[cosmos] acerto do assistente falhou; fica para conciliação', {
          reservationId,
          tenantId: input.tenantId,
          err,
        });
        break;
      }
      await sleep(backoff[attempt]!);
    }
  }
  const available = settled?.available ?? (await getWallet(db, input.tenantId))?.available ?? 0;
  yield {
    type: 'done',
    charged: settled?.charged ?? 0,
    available,
    ...(input.signingKey && !failed
      ? { sig: signAssistantTurn(input.signingKey, { tenantId: input.tenantId, userId: input.userId }, text) }
      : {}),
  };
}
