/**
 * Assistente da Cosmos em fluxo (#1003): reserva os créditos da estimativa, chama o modelo, manda o texto aos
 * pedaços (NDJSON) e acerta pelo custo real no fim. Sem reserva, nenhuma chamada; falha ou desistência devolve a
 * reserva. O tenant sai da sessão, nunca do navegador.
 *
 *   {"type":"start","reserved":3}
 *   {"type":"delta","text":"…"}
 *   {"type":"done","charged":2.4,"available":120}
 *   {"type":"error","code":"insufficient"}
 *
 * TODO(#1018): conferir o módulo da Cosmos no plano do tenant. TODO(#1019): permissão do cargo para o assistente.
 */
import {
  ASSISTANT_FUNCTION,
  ASSISTANT_MODEL,
  assistantCostUsd,
  isCosmosError,
  release,
  reserve,
  settle,
  streamAssistant,
  type StreamUsage,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import { readClientContext } from '@/lib/client/session';
import { assistantApiKey, parseAssistantRequest, prepareQuestion } from '@/lib/cosmos/assistant-server';
import type { AssistantErrorCode } from '@/lib/cosmos/assistant-stream';
import { getRequestLocale } from '@/lib/i18n/server';

const RESERVE_ERRORS: Record<string, AssistantErrorCode> = {
  insufficient_credits: 'insufficient',
  wallet_blocked: 'blocked',
  cosmos_disabled: 'disabled',
  no_wallet: 'no_wallet',
  unknown_function: 'unavailable',
  safety_ceiling: 'unavailable',
};

const line = (o: object) => `${JSON.stringify(o)}\n`;
const fail = (code: AssistantErrorCode, status: number) =>
  new Response(line({ type: 'error', code }), {
    status,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  });

export async function POST(request: Request) {
  const ctx = await readClientContext();
  if (!ctx?.tenant) return fail('unauthorized', 401);
  const tenantId = ctx.tenant.id;
  const req = parseAssistantRequest(await request.json().catch(() => null));
  if (!req) return fail('bad_request', 400);
  const apiKey = assistantApiKey();
  if (!apiKey) return fail('unavailable', 503);
  const locale = await getRequestLocale();
  const prepared = await prepareQuestion(tenantId, req, locale);
  if (!prepared) return fail('unavailable', 503);

  const db = builderDb();
  let reservation;
  try {
    reservation = await reserve(
      db,
      {
        tenantId,
        functionName: ASSISTANT_FUNCTION,
        estimatedCredits: prepared.credits,
        scope: 'assistant',
        userId: ctx.userId,
      },
      { settings: prepared.settings },
    );
  } catch (err) {
    if (isCosmosError(err)) return fail(RESERVE_ERRORS[err.code] ?? 'failed', 402);
    throw err;
  }

  const encoder = new TextEncoder();
  const usage: StreamUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: object) => controller.enqueue(encoder.encode(line(o)));
      send({ type: 'start', reserved: reservation.credits });
      try {
        for await (const text of streamAssistant(apiKey, prepared.prompt, usage, { signal: request.signal }))
          send({ type: 'delta', text });
        const result = await settle(db, {
          tenantId,
          reservationId: reservation.id,
          costUsd: assistantCostUsd(usage),
          tokensIn: usage.inputTokens,
          tokensCached: usage.cachedInputTokens,
          tokensOut: usage.outputTokens,
          model: ASSISTANT_MODEL,
          metadata: { route: req.context.route },
        });
        send({ type: 'done', charged: result.charged, available: result.available });
      } catch (err) {
        console.error('[cosmos] assistente falhou', err);
        // nada foi entregue de vez: a reserva volta inteira
        await release(db, { tenantId, reservationId: reservation.id }).catch(() => {});
        send({ type: 'error', code: 'failed' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
