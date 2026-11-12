/**
 * Assistente da Cosmos em fluxo (#1003). A regra de cobrança mora em `askAssistant` (@galaxie/cosmos): sem reserva,
 * nenhuma chamada; nada entregue, a reserva volta; algo entregue, acerta pelo usado, nunca acima da reserva. Aqui
 * ficam a sessão, quem pode perguntar e o fluxo em NDJSON:
 *
 *   {"type":"start","reserved":3}
 *   {"type":"delta","text":"…"}
 *   {"type":"done","charged":2.4,"available":120,"sig":"…"}
 *   {"type":"error","code":"insufficient"}
 *
 * O navegador que fecha ou o "Parar" cortam o provedor, mas o acerto segue até o fim no servidor.
 */
import {
  askAssistant,
  askAssistantAsStaff,
  assistantAdmissionError,
  type AssistantErrorCode,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import { readClientContext } from '@/lib/client/session';
import {
  assistantAccessError,
  assistantSigningKey,
  parseAssistantRequest,
  parseAttachmentFiles,
  prepareQuestion,
} from '@/lib/cosmos/assistant-server';
import { getRequestLocale } from '@/lib/i18n/server';

/** Duração máxima da rota (s): menor que o prazo da reserva (300 s), para a limpeza nunca devolver uma pergunta viva. */
export const maxDuration = 90;

/** Teto da chamada ao provedor (ms). */
const PROVIDER_TIMEOUT_MS = 60_000;

const STATUS: Partial<Record<AssistantErrorCode, number>> = {
  unauthorized: 401,
  bad_request: 400,
  staff: 403,
  module: 403,
  role: 403,
  unavailable: 503,
  busy: 429,
  rate_limited: 429,
  tenant_limit: 429,
  attachment: 400,
  attachment_unsupported: 400,
};

const line = (o: object) => `${JSON.stringify(o)}\n`;
const fail = (code: AssistantErrorCode, status = STATUS[code] ?? 402) =>
  new Response(line({ type: 'error', code }), {
    status,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  });

export async function POST(request: Request) {
  const ctx = await readClientContext();
  if (!ctx) return fail('unauthorized');
  const denied = assistantAccessError(ctx);
  if (denied) return fail(denied);
  const tenantId = ctx.tenant!.id;
  const body: unknown = await request.json().catch(() => null);
  const req = parseAssistantRequest(body);
  if (!req) return fail('bad_request');
  // anexos lidos e conferidos antes de qualquer reserva (#1065); ficam só na memória desta pergunta
  const read = parseAttachmentFiles((body as { attachments?: unknown }).attachments);
  if (!read.ok) return fail('attachment');
  const files = read.files;
  const scope = { tenantId, userId: ctx.userId };
  const locale = await getRequestLocale();
  // admissão antes da busca por significado: o vetor da pergunta é chamada paga, e quem seria recusado (limite,
  // saldo, carteira) não chega a ela. Os créditos não dependem da busca, então a estimativa por palavras já serve.
  if (ctx.role !== 'admin') {
    const quick = await prepareQuestion(scope, req, locale, { files });
    if (quick === 'attachment_unsupported') return fail(quick);
    if (!quick) return fail('unavailable');
    const refused = await assistantAdmissionError(builderDb(), {
      ...scope,
      settings: quick.settings,
      credits: quick.credits,
    });
    if (refused) return fail(refused);
  }
  const prepared = await prepareQuestion(scope, req, locale, {
    semantic: true,
    signal: request.signal,
    files,
  });
  if (prepared === 'attachment_unsupported') return fail(prepared);
  if (!prepared) return fail('unavailable');

  const deps = {
    // desistência (navegador fechou, "Parar") ou o teto de tempo cortam o provedor
    stream: (signal: AbortSignal, usage: Parameters<typeof prepared.streamer>[0]['usage']) =>
      prepared.streamer({
        apiKey: prepared.apiKey,
        model: prepared.model,
        prompt: prepared.prompt,
        usage,
        signal: AbortSignal.any([signal, request.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]),
      }),
    signal: request.signal,
  };
  // a equipe Galaxie acompanhando o tenant não gasta os créditos dele: o custo fica em cosmos.staff_usage
  const events =
    ctx.role === 'admin'
      ? askAssistantAsStaff(
          builderDb(),
          {
            ...scope,
            route: req.context.route,
            prompt: prepared.prompt,
            provider: prepared.provider,
            model: prepared.model,
            signingKey: assistantSigningKey(),
            attachments: prepared.attachments,
          },
          deps,
        )
      : askAssistant(
          builderDb(),
          {
            ...scope,
            route: req.context.route,
            prompt: prepared.prompt,
            credits: prepared.credits,
            settings: prepared.settings,
            model: prepared.model,
            signingKey: assistantSigningKey(),
            attachments: prepared.attachments,
          },
          deps,
        );

  // a primeira resposta decide o status: recusa antes de reservar sai como erro HTTP
  const first = await events.next();
  if (first.done) return fail('failed', 500);
  if (first.value.type === 'error') return fail(first.value.code);

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: object) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(line(o)));
        } catch {
          open = false;
        }
      };
      try {
        send(first.value);
        // segue até o fim mesmo sem ninguém lendo: o acerto acontece depois do último pedaço
        for await (const event of events) send(event);
      } catch (err) {
        console.error('[cosmos] assistente falhou', err);
        send({ type: 'error', code: 'failed' });
      } finally {
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // já fechado pelo navegador
          }
        }
      }
    },
    cancel() {
      // o navegador fechou: para de mandar; o provedor é cortado pelo request.signal e o acerto segue
      open = false;
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
