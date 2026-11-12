/**
 * `GET /v1/chat/rooms/{jogo}/stream` (#964): os lotes da sala como Server-Sent Events. Um evento `chat.batch` por
 * lote (no máximo um por segundo), com `id:` = número do lote. Reconexão: o cliente manda `Last-Event-ID` (ou
 * `?last_batch_id=`) e recebe os lotes que perdeu, do histórico curto; se o buraco já saiu dele, vem `chat.reset` e o
 * cliente relê a sala pelo GET.
 *
 * Ler é livre: chave secreta no servidor ou a publicável no navegador (header: use um cliente SSE sobre `fetch`; a
 * chave nunca vai na URL). A faixa de conexões do cliente (`live_chat.peak_connections`) não derruba ninguém: acima
 * dela a conexão entra, recebe `chat.state` com `read_only_peak` e o cliente fica em pico (D6, `peak.ts`).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import { ChatRoomParams } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import type { ChatRoomState } from '@galaxie/engage';
import { ProblemError, problems } from '../errors.js';
import { moduleLimitsOf } from '../engage/module-limits.js';
import { formatSse, processLimitRetryAfter, SseConnection } from '../realtime/sse.js';
import { parseInput } from '../util.js';
import { ChatHub, type ChatBatch } from './hub.js';
import { PEAK_FLAG_MS, type ChatPeak } from './peak.js';

export interface ChatStreamOptions {
  /** Streams do chat abertos neste processo (todos os clientes). Padrão 5000. */
  maxConnections?: number;
  /** Heartbeat. Padrão 15 s. */
  heartbeatMs?: number;
  /** Bytes enfileirados para um cliente lento antes de derrubar. Padrão 256 KiB. */
  maxBufferBytes?: number;
  retryMs?: number;
  /** Faixa de conexões fixa no lugar da do cliente (testes). */
  peakLimitOverride?: number;
}

interface Deps {
  db: Database | undefined;
  hub: ChatHub;
  peak: ChatPeak;
  options: ChatStreamOptions;
  roomState(tenantId: string, fixtureId: string): Promise<ChatRoomState>;
}

const StreamQuery = z.object({ last_batch_id: z.coerce.number().int().min(0).optional() });
const REVALIDATE_WITHIN_MS = 60_000;
const DEFAULT_PEAK = 5_000;

export function registerChatStream(app: FastifyInstance, deps: Deps): void {
  const maxProcess = deps.options.maxConnections ?? 5_000;
  const heartbeatMs = deps.options.heartbeatMs ?? 15_000;
  const maxBufferBytes = deps.options.maxBufferBytes ?? 256 * 1024;
  const retryMs = deps.options.retryMs ?? 3_000;
  const open = new Set<SseConnection>();
  let reserved = 0;

  // faixa do cliente, relida no máximo a cada minuto
  const tiers = new Map<string, { at: number; value: number }>();
  async function peakLimit(tenantId: string, modules: readonly string[]): Promise<number> {
    if (deps.options.peakLimitOverride != null) return deps.options.peakLimitOverride;
    const hit = tiers.get(tenantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    let value = hit?.value ?? DEFAULT_PEAK;
    try {
      if (deps.db) {
        const limits = await moduleLimitsOf(deps.db, tenantId, modules as never);
        value = limits.find((l) => l.key === 'live_chat.peak_connections')?.value ?? DEFAULT_PEAK;
      }
    } catch {
      // banco fora: segue com o último valor
    }
    if (tiers.size > 10_000) tiers.clear();
    tiers.set(tenantId, { at: Date.now(), value });
    return value;
  }

  app.addHook('preClose', async () => {
    for (const conn of open) conn.close();
  });

  app.get(
    '/v1/chat/rooms/:fixtureId/stream',
    { config: { module: 'live_chat', longLived: true } },
    async (request, reply): Promise<void> => {
      const { fixtureId } = parseInput(ChatRoomParams, request.params);
      const q = parseInput(StreamQuery, request.query);
      const header = request.headers['last-event-id'];
      const headerId = Array.isArray(header) ? header[0] : header;
      if (headerId != null && headerId !== '' && !/^\d+$/.test(headerId))
        throw problems.invalidParams([{ path: 'Last-Event-ID', message: 'deve ser o número de um lote' }]);
      const lastBatchId = headerId ? Number(headerId) : q.last_batch_id;

      let tenant = request.tenant!;
      const state = await deps.roomState(tenant.tenantId, fixtureId);
      const room = ChatHub.roomKey(tenant.tenantId, fixtureId);

      if (reserved >= maxProcess)
        throw new ProblemError(
          503,
          'DEGRADED',
          'Limite de conexões do chat desta instância atingido',
          'Tente reconectar após o Retry-After; enquanto isso, leia a sala pelo GET.',
          { headers: { 'retry-after': String(processLimitRetryAfter()) } },
        );
      reserved += 1;
      let slotHeld = true;
      const releaseSlot = () => {
        if (!slotHeld) return;
        slotHeld = false;
        reserved -= 1;
      };

      const res = reply.raw;
      let clientGone = false;
      const onEarlyClose = () => {
        clientGone = true;
      };
      res.once('close', onEarlyClose);
      const connectionId = randomUUID();
      const limit = await peakLimit(tenant.tenantId, tenant.modules);
      const acquired = await deps.peak.connections
        .acquire(tenant.tenantId, connectionId, limit)
        .catch((err: unknown) => {
          request.log.warn({ err }, 'chat: limite de conexões indisponível');
          return true;
        });
      res.off('close', onEarlyClose);
      if (clientGone || res.destroyed) {
        releaseSlot();
        if (acquired) deps.peak.connections.release(tenant.tenantId, connectionId).catch(() => {});
        reply.hijack();
        res.destroy();
        return;
      }
      const overflow = !acquired;
      if (overflow) {
        request.log.warn(
          { tenant: tenant.slug, limit },
          'chat: faixa de conexões estourada, sala só leitura para quem entra',
        );
        await deps.peak.markPeak(tenant.tenantId).catch(() => {});
      }

      reply.hijack();
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(reply.getHeaders())) if (v != null) headers[k] = String(v);
      res.writeHead(200, {
        ...headers,
        ...app.securityHeaders?.(request, 'text/event-stream'),
        ...app.corsHeaders?.(request),
        ...(app.corsHeaders ? { vary: 'Origin' } : {}),
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-store, no-transform',
        'x-accel-buffering': 'no',
        'x-robots-tag': 'noindex, nofollow',
      });
      request.raw.socket.setNoDelay(true);

      const conn = new SseConnection(res, maxBufferBytes, () => {
        request.log.warn({ tenant: tenant.slug }, 'chat SSE: cliente lento desconectado');
        conn.destroy();
      });
      open.add(conn);

      // o lote ao vivo pode chegar enquanto o replay ainda lê o histórico: guarda e entrega na ordem, sem repetir
      let replaying = true;
      let lastSent = lastBatchId ?? 0;
      const backlog: ChatBatch[] = [];
      const sendBatch = (b: ChatBatch) => {
        if (b.id <= lastSent) return;
        lastSent = b.id;
        conn.write(formatSse('chat.batch', { batch_id: b.id, messages: b.messages }, String(b.id)));
      };
      const unsubscribe = deps.hub.subscribe(room, (b) => (replaying ? backlog.push(b) : sendBatch(b)));

      const maxAgeMs = Math.max(0, REVALIDATE_WITHIN_MS - heartbeatMs);
      let revalidating = false;
      const revalidate = async () => {
        if (!request.reauthenticate || conn.closed || revalidating) return;
        revalidating = true;
        try {
          const ctx = await request.reauthenticate(maxAgeMs);
          if (!ctx.modules.includes('live_chat')) throw problems.moduleNotInPlan('live_chat');
          if (ctx.tenantId === tenant.tenantId) tenant = ctx;
        } catch (err) {
          if (!(err instanceof ProblemError) || err.status >= 500 || err.status === 429) return;
          conn.write(formatSse('access_revoked', { code: err.code, message: err.title }));
          conn.close();
        } finally {
          revalidating = false;
        }
      };
      const heartbeat = setInterval(
        () => {
          conn.write(`: hb ${Date.now()}\n\n`);
          if (acquired) deps.peak.connections.renew(tenant.tenantId, connectionId).catch(() => {});
          else deps.peak.markPeak(tenant.tenantId).catch(() => {});
          void revalidate();
        },
        Math.min(heartbeatMs, PEAK_FLAG_MS / 3),
      );
      heartbeat.unref();

      res.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        open.delete(conn);
        releaseSlot();
        conn.closed = true;
        if (acquired) deps.peak.connections.release(tenant.tenantId, connectionId).catch(() => {});
      });

      conn.write(`retry: ${retryMs}\n: galaxie-sports chat\n\n`);
      try {
        conn.write(
          formatSse('chat.state', {
            state: overflow && state === 'open' ? 'read_only_peak' : state,
            ...(overflow ? { reason: 'peak' } : {}),
          }),
        );
        let resumeFrom = await deps.hub.latestId(room);
        if (lastBatchId != null) {
          const r = await deps.hub.since(room, lastBatchId);
          for (const b of r.batches) sendBatch(b);
          if (!r.complete)
            conn.write(
              formatSse('chat.reset', {
                message:
                  'Parte das mensagens desde o último lote saiu do histórico curto; releia a sala pelo GET.',
              }),
            );
          resumeFrom = Math.max(resumeFrom, lastSent);
        } else lastSent = resumeFrom;
        replaying = false;
        backlog.sort((a, b) => a.id - b.id);
        for (const b of backlog.splice(0)) sendBatch(b);
        conn.write(formatSse('ready', { last_batch_id: resumeFrom }));
      } catch (err) {
        request.log.warn({ err }, 'chat SSE: falha na retomada');
        conn.close();
      }
    },
  );
}
