/**
 * Uma tarefa da Cosmos de uma chamada só (#1005: widget por frase, código de instalação): pede ao modelo uma resposta
 * inteira, deixa quem chamou conferir o resultado e acerta a carteira. Regras de cobrança, as mesmas da moderação:
 *
 * - Sem reserva, nenhuma chamada ao provedor. O mínimo de cada função vem do catálogo (`cosmos.function_def`).
 * - Falha no provedor: a reserva volta inteira.
 * - Resposta que não serve (fora do formato ou sem nada válido depois da conferência): o custo vai para o extrato, sem
 *   débito (`waive`).
 * - O acerto nunca passa da reserva, e é repetido se falhar; se ainda falhar, vai para o log para conciliação.
 *
 * A equipe Galaxie acompanhando um tenant não gasta créditos dele: o custo real fica em `cosmos.staff_usage`.
 */
import { estimateCostUsd } from '@galaxie/ai-ledger/pricing';
import type { Database } from '@galaxie/db/client';
import { reservation, staffUsage } from '@galaxie/db/schema';
import {
  createCompletionClient,
  type CompletionAttachment,
  type CompletionClient,
  type CompletionResult,
} from '@galaxie/llm';
import { and, count, eq, gte } from 'drizzle-orm';

import { creditsFor } from './credits.js';
import { isCosmosError } from './errors.js';
import { cosmosApiKey } from './models.js';
import type { CosmosSettings } from './settings.js';
import { activeFunction, getWallet, release, reserve, settle } from './wallet.js';

/** Limites das tarefas de uma chamada. Fora daqui, nada; ajustar é mudar estes números. */
export const TASK_LIMITS = {
  /**
   * Pedidos por pessoa por minuto, em cada função. A contagem vem antes da reserva, então pedidos simultâneos podem
   * passar juntos: o saldo segue protegido pela reserva, só o ritmo vaza (aceito).
   */
  userPerMinute: 6,
  /** Tempo máximo da chamada ao provedor (ms). */
  timeoutMs: 45_000,
} as const;

/** Prazo da reserva: maior que o tempo máximo da chamada, para a limpeza nunca devolver uma tarefa viva. */
export const TASK_RESERVATION_TTL_SECONDS = 180;

export type TaskErrorCode =
  | 'unavailable'
  | 'insufficient'
  | 'blocked'
  | 'disabled'
  | 'no_wallet'
  | 'rate_limited'
  | 'failed'
  | 'unreadable';

const RESERVE_ERRORS: Record<string, TaskErrorCode> = {
  insufficient_credits: 'insufficient',
  wallet_blocked: 'blocked',
  cosmos_disabled: 'disabled',
  no_wallet: 'no_wallet',
  unknown_function: 'unavailable',
  safety_ceiling: 'unavailable',
};

export interface TaskInput<T> {
  tenantId: string;
  userId: string;
  /** Nome da função no catálogo (o mínimo em créditos, o provedor e o modelo vêm de lá). */
  functionName: string;
  /** Tela ou produto, para o extrato. */
  scope: string;
  system: string;
  message: string;
  maxOutputTokens: number;
  /** Arquivos (PDF ou imagem) que o modelo lê junto da mensagem; a reserva conta os tokens deles. */
  attachments?: CompletionAttachment[];
  /** Vai para o extrato junto do acerto (nunca o texto do cliente). */
  metadata?: Record<string, unknown>;
  /**
   * Confere a resposta do modelo. `usable: false` = nada aproveitável (não cobra). Roda antes do acerto, então pode
   * consultar a API (busca de entidades) e validar com as regras do servidor.
   */
  evaluate: (text: string) => Promise<{ usable: boolean; value: T }>;
  /** Equipe Galaxie: não reserva nem cobra; o custo vai para `cosmos.staff_usage` com esta rota. */
  staff?: { route: string };
}

export interface TaskDeps {
  /** Cliente do modelo (testes); sem ele, o do provedor da função. */
  client?: CompletionClient;
  env?: Record<string, string | undefined>;
  settings: CosmosSettings;
  now?: () => Date;
  /** Esperas entre as tentativas do acerto (ms). */
  settleBackoffMs?: readonly number[];
  timeoutMs?: number;
}

export type TaskResult<T> =
  | { ok: true; value: T; usable: boolean; charged: number; staff?: true }
  | { ok: false; error: TaskErrorCode };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Caracteres por token na estimativa da reserva (para mais: a reserva cobre a chamada). */
const CHARS_PER_TOKEN = 3;

/** Pedidos da pessoa nesta função no último minuto (reservas do cliente ou linhas da equipe). */
async function overLimit(
  db: Database,
  input: { tenantId: string; userId: string; functionName: string; staff?: { route: string } },
  at: Date,
): Promise<boolean> {
  const since = new Date(at.getTime() - 60_000);
  const [row] = input.staff
    ? await db
        .select({ n: count() })
        .from(staffUsage)
        .where(
          and(
            eq(staffUsage.userId, input.userId),
            eq(staffUsage.route, input.staff.route.slice(0, 200)),
            gte(staffUsage.createdAt, since),
          ),
        )
    : await db
        .select({ n: count() })
        .from(reservation)
        .where(
          and(
            eq(reservation.tenantId, input.tenantId),
            eq(reservation.functionName, input.functionName),
            eq(reservation.userId, input.userId),
            gte(reservation.createdAt, since),
          ),
        );
  return (row?.n ?? 0) >= TASK_LIMITS.userPerMinute;
}

/** Tokens de entrada por imagem na reserva (para mais: uma imagem grande custa perto de 1,6 mil nos provedores). */
export const IMAGE_TOKENS = 1_800;
/** Tokens de entrada por página de PDF na reserva (o texto e a imagem da página). */
export const PDF_PAGE_TOKENS = 3_000;

/** Páginas de um PDF em base64 (contagem dos objetos `/Type /Page`); pelo menos 1. */
export function pdfPages(base64: string): number {
  const text = Buffer.from(base64, 'base64').toString('latin1');
  return Math.max(1, (text.match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length);
}

/** Tokens de entrada estimados dos anexos, para a reserva cobrir a chamada. */
export function attachmentTokens(files: readonly CompletionAttachment[] = []): number {
  return files.reduce(
    (n, f) => n + (f.mediaType === 'application/pdf' ? pdfPages(f.data) * PDF_PAGE_TOKENS : IMAGE_TOKENS),
    0,
  );
}

/** Custo real da resposta pelo uso do provedor. */
const costOf = (model: string, result: CompletionResult) =>
  estimateCostUsd(model, {
    inputTokens: result.usage.inputTokens,
    cachedInputTokens: result.usage.cachedInputTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    outputTokens: result.usage.outputTokens,
  });

/** Créditos que a reserva pede: a chamada estimada pelo tamanho do prompt e pela saída máxima, nunca abaixo do mínimo. */
export function estimateTaskCredits(input: {
  model: string;
  system: string;
  message: string;
  maxOutputTokens: number;
  minCredits: number;
  multiplier: number;
  settings: CosmosSettings;
  attachments?: readonly CompletionAttachment[] | undefined;
}): number {
  return creditsFor({
    costUsd: estimateCostUsd(input.model, {
      inputTokens:
        Math.ceil((input.system.length + input.message.length) / CHARS_PER_TOKEN) +
        attachmentTokens(input.attachments),
      outputTokens: input.maxOutputTokens,
    }),
    multiplier: input.multiplier,
    creditUsd: input.settings.creditUsd,
    minCredits: input.minCredits,
  });
}

export async function runCosmosTask<T>(
  db: Database,
  input: TaskInput<T>,
  deps: TaskDeps,
): Promise<TaskResult<T>> {
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;
  const timeoutMs = deps.timeoutMs ?? TASK_LIMITS.timeoutMs;

  const fn = await activeFunction(db, input.functionName);
  const apiKey = fn ? cosmosApiKey(fn.provider, env) : null;
  if (!fn || (!deps.client && !apiKey)) return { ok: false, error: 'unavailable' };
  if (await overLimit(db, input, now())) return { ok: false, error: 'rate_limited' };

  const call = () => {
    const client =
      deps.client ?? createCompletionClient(fn.provider, { apiKey: apiKey!, maxRetries: 0, timeoutMs });
    return client.complete({
      model: fn.model,
      system: input.system,
      messages: [{ role: 'user', content: input.message }],
      maxOutputTokens: input.maxOutputTokens,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      json: true,
      timeoutMs,
      signal: AbortSignal.timeout(timeoutMs),
      purpose: `cosmos:${input.functionName}:${input.tenantId}`,
    });
  };

  if (input.staff) return runAsStaff(db, input, fn, call);

  const wallet = await getWallet(db, input.tenantId);
  const estimate = estimateTaskCredits({
    model: fn.model,
    system: input.system,
    message: input.message,
    maxOutputTokens: input.maxOutputTokens,
    attachments: input.attachments,
    minCredits: fn.minCredits,
    multiplier: wallet?.multiplier ?? 1,
    settings: deps.settings,
  });

  let held: { id: string; credits: number };
  try {
    held = await reserve(
      db,
      {
        tenantId: input.tenantId,
        functionName: input.functionName,
        estimatedCredits: estimate,
        scope: input.scope,
        userId: input.userId,
        ttlSeconds: TASK_RESERVATION_TTL_SECONDS,
      },
      { settings: deps.settings, now: now() },
    );
  } catch (err) {
    if (isCosmosError(err)) return { ok: false, error: RESERVE_ERRORS[err.code] ?? 'unavailable' };
    throw err;
  }

  let result: CompletionResult;
  try {
    result = await call();
  } catch (err) {
    await release(db, { tenantId: input.tenantId, reservationId: held.id }).catch((e) =>
      console.error('[cosmos] reserva da tarefa não voltou', { fn: input.functionName, e }),
    );
    console.error('[cosmos] tarefa falhou no provedor', { fn: input.functionName, err });
    return { ok: false, error: 'failed' };
  }
  // o provedor já respondeu (e cobrou): falha na conferência vira resposta que não serve, com o custo no extrato
  let evaluated: { usable: boolean; value: T | null };
  try {
    evaluated = await input.evaluate(result.text);
  } catch (err) {
    console.error('[cosmos] conferência da tarefa falhou', { fn: input.functionName, err });
    evaluated = { usable: false, value: null };
  }

  const costUsd = costOf(fn.model, result);
  const backoff = deps.settleBackoffMs ?? [200, 800];
  let charged = 0;
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    try {
      const s = await settle(db, {
        tenantId: input.tenantId,
        reservationId: held.id,
        costUsd,
        maxCredits: held.credits,
        tokensIn: result.usage.inputTokens,
        tokensCached: result.usage.cachedInputTokens,
        tokensOut: result.usage.outputTokens,
        model: fn.model,
        // resposta que não serve não vira cobrança: o custo vai para o extrato, sem débito
        ...(evaluated.usable ? {} : { waive: true }),
        metadata: { kind: input.functionName, usable: evaluated.usable, ...input.metadata },
      });
      charged = s.charged;
      break;
    } catch (err) {
      if (isCosmosError(err, 'reservation_closed') || attempt === backoff.length) {
        console.error('[cosmos] acerto da tarefa falhou; fica para conciliação', {
          fn: input.functionName,
          tenantId: input.tenantId,
          reservationId: held.id,
          costUsd,
          err,
        });
        break;
      }
      await sleep(backoff[attempt]!);
    }
  }
  if (!evaluated.usable) return { ok: false, error: 'unreadable' };
  return { ok: true, value: evaluated.value as T, usable: true, charged };
}

async function runAsStaff<T>(
  db: Database,
  input: TaskInput<T>,
  fn: { provider: string; model: string },
  call: () => Promise<CompletionResult>,
): Promise<TaskResult<T>> {
  const [row] = await db
    .insert(staffUsage)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      route: input.staff!.route.slice(0, 200),
      provider: fn.provider,
      model: fn.model,
    })
    .returning({ id: staffUsage.id });
  let result: CompletionResult | null = null;
  let evaluated: { usable: boolean; value: T } | null = null;
  let error: string | null = null;
  try {
    result = await call();
    evaluated = await input.evaluate(result.text);
  } catch (err) {
    error = String((err as Error)?.message ?? err).slice(0, 500);
    console.error('[cosmos] tarefa da equipe falhou', { fn: input.functionName, err });
  }
  if (row)
    await db
      .update(staffUsage)
      .set({
        inputTokens: result?.usage.inputTokens ?? 0,
        outputTokens: result?.usage.outputTokens ?? 0,
        costUsd: (result ? costOf(fn.model, result) : 0).toFixed(6),
        outcome: error || !evaluated?.usable ? 'error' : 'ok',
        error: error ?? (evaluated?.usable ? null : 'unreadable'),
      })
      .where(eq(staffUsage.id, row.id))
      .catch((err) => console.error('[cosmos] uso da tarefa da equipe não foi registrado', err));
  if (error || !evaluated) return { ok: false, error: 'failed' };
  if (!evaluated.usable) return { ok: false, error: 'unreadable' };
  return { ok: true, value: evaluated.value, usable: true, charged: 0, staff: true };
}

/**
 * JSON da resposta do modelo: o objeto inteiro, ou o primeiro `{…}` do texto (modelo que embrulha em cerca de código
 * ou comenta antes). null se não houver objeto legível.
 */
export function parseModelJson(text: string): Record<string, unknown> | null {
  const tryParse = (s: string) => {
    try {
      const v: unknown = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? tryParse(text.slice(start, end + 1)) : null;
}
