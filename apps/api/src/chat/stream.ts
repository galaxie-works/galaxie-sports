/**
 * `GET /v1/chat/rooms/{jogo}/stream` (#964): os lotes da sala como Server-Sent Events. Um evento `chat.batch` por
 * lote, com `id:` = `<época>-<lote>`. Reconexão: o cliente manda `Last-Event-ID` (ou `?last_event_id=`) e recebe os
 * lotes que perdeu, do histórico curto; se não dá para emendar (o buraco saiu do histórico, a sequência recomeçou),
 * vem `chat.reset` e o cliente relê a sala pelo GET.
 *
 * Ler é livre: chave secreta no servidor ou a publicável no navegador (header: use um cliente SSE sobre `fetch`; a
 * chave nunca vai na URL). A faixa de conexões do cliente (`live_chat.peak_connections`) não derruba ninguém: acima
 * dela a conexão entra, recebe `chat.state` com `read_only_peak` e o cliente fica em pico (D6, `peak.ts`). Com a
 * chave publicável há também um teto por chave e IP, para poucos endereços não esgotarem a faixa do cliente.
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
import { ChatHub, formatCursor, parseCursor, type ChatBatch, type ChatCursor } from './hub.js';
import { PEAK_FLAG_MS, type ChatPeak } from './peak.js';

export interface ChatStreamOptions {
  /** Streams do chat abertos neste processo (todos os clientes). Padrão 5000. */
  maxConnections?: number;
  /** Heartbeat. Padrão 15 s. */
  heartbeatMs?: number;
  /** Bytes enfileirados para um cliente lento antes de derrubar. Padrão 1 MiB (cerca de 7 lotes cheios). */
  maxBufferBytes?: number;
  retryMs?: number;
  /** Streams simultâneos por chave publicável e IP. Padrão 20. */
  maxPerPublishableIp?: number;
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

const StreamQuery = z.object({ last_event_id: z.string().max(40).optional() });
const REVALIDATE_WITHIN_MS = 60_000;
const DEFAULT_PEAK = 5_000;

export function registerChatStream(app: FastifyInstance, deps: Deps): void {
  const maxProcess = deps.options.maxConnections ?? 5_000;
  const heartbeatMs = deps.options.heartbeatMs ?? 15_000;
  const maxBufferBytes = deps.options.maxBufferBytes ?? 1024 * 1024;
  const retryMs = deps.options.retryMs ?? 3_000;
  const maxPerIp = deps.options.maxPerPublishableIp ?? 20;
  const open = new Set<SseConnection>();
  let reserved = 0;

  // um aviso de pico por cliente por minuto no log (no pico, milhares de conexões excedentes por minuto)
  const peakLogged = new Map<string, number>();
  const logPeak = (log: { warn(o: object, m: string): void }, tenant: string, limit: number) => {
    const at = peakLogged.get(tenant) ?? 0;
    if (Date.now() - at < 60_000) return;
    if (peakLogged.size > 10_000) peakLogged.clear();
    peakLogged.set(tenant, Date.now());
    log.warn({ tenant, limit }, 'chat: faixa de conexões estourada, sala só leitura para quem entra');
  };

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
      const resume = parseCursor((Array.isArray(header) ? header[0] : header) || q.last_event_id);
      if (resume === null)
        throw problems.invalidParams([
          { path: 'Last-Event-ID', message: 'deve ser o id de um evento chat.batch (<época>-<lote>)' },
        ]);

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
      // chave publicável: teto por chave e IP antes de ocupar a faixa do cliente
      const clientKey = tenant.keyKind === 'publishable' ? `${tenant.keyId}:${request.ip}` : null;
      const clientOk = clientKey
        ? await deps.peak.perClient.acquire(clientKey, connectionId, maxPerIp).catch(() => true)
        : true;
      const limit = await peakLimit(tenant.tenantId, tenant.modules);
      let acquired = clientOk
        ? await deps.peak.connections.acquire(tenant.tenantId, connectionId, limit).catch((err: unknown) => {
            request.log.warn({ err }, 'chat: limite de conexões indisponível');
            return true;
          })
        : false;
      let released = false;
      const releaseLeases = () => {
        if (released) return;
        released = true;
        if (acquired) deps.peak.connections.release(tenant.tenantId, connectionId).catch(() => {});
        if (clientKey && clientOk) deps.peak.perClient.release(clientKey, connectionId).catch(() => {});
      };
      // nenhum await daqui até o 'close' definitivo: quem cai agora não deixa vaga, lease nem relógio presos
      res.off('close', onEarlyClose);
      if (clientGone || res.destroyed) {
        releaseSlot();
        releaseLeases();
        reply.hijack();
        res.destroy();
        return;
      }
      if (!clientOk) {
        releaseSlot();
        releaseLeases();
        throw new ProblemError(
          429,
          'RATE_LIMITED',
          'Muitas conexões do chat a partir deste endereço',
          `Máximo de ${maxPerIp} streams do chat abertos por chave publicável e IP.`,
          { headers: { 'retry-after': '30' } },
        );
      }
      const overflow = !acquired;
      if (overflow) {
        logPeak(request.log, tenant.slug, limit);
        void deps.peak.markPeak(tenant.tenantId).catch(() => {});
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

      let cursor: ChatCursor = resume ?? { epoch: '', id: 0 };
      const reset = (why: string) => conn.write(formatSse('chat.reset', { message: why }));
      const write = (b: ChatBatch) => {
        cursor = { epoch: b.epoch, id: b.id };
        conn.write(formatSse('chat.batch', { batch_id: b.id, messages: b.messages }, formatCursor(cursor)));
      };
      // Entrega em ordem, um lote por vez. Buraco (o pub/sub perdeu lotes enquanto a assinatura estava fora) é
      // emendado pelo histórico; época nova (a sequência recomeçou no Valkey) ou buraco fora do histórico: chat.reset
      const deliver = async (b: ChatBatch) => {
        if (conn.closed) return;
        if (b.epoch !== cursor.epoch) {
          if (cursor.epoch !== '' && cursor.id > 0)
            reset('A sala recomeçou a numeração dos lotes; releia a sala pelo GET.');
          cursor = { epoch: b.epoch, id: b.id - 1 };
        }
        if (b.id <= cursor.id) return;
        if (b.id > cursor.id + 1) {
          const r = await deps.hub.since(room, cursor).catch(() => null);
          if (!r || !r.complete) {
            reset('Parte das mensagens não chegou; releia a sala pelo GET.');
            cursor = { epoch: b.epoch, id: b.id - 1 };
          } else for (const missed of r.batches) if (missed.id > cursor.id && missed.id < b.id) write(missed);
        }
        if (b.id > cursor.id) write(b);
      };
      let replaying = true;
      let chain: Promise<void> = Promise.resolve();
      const backlog: ChatBatch[] = [];
      const enqueueDelivery = (b: ChatBatch) => {
        chain = chain.then(() => deliver(b)).catch(() => {});
      };
      const unsubscribe = deps.hub.subscribe(room, (b) => (replaying ? backlog.push(b) : enqueueDelivery(b)));

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
      let retrying = false;
      const heartbeat = setInterval(
        () => {
          conn.write(`: hb ${Date.now()}\n\n`);
          if (clientKey) deps.peak.perClient.renew(clientKey, connectionId).catch(() => {});
          if (acquired) deps.peak.connections.renew(tenant.tenantId, connectionId).catch(() => {});
          else if (!retrying) {
            // excedente: tenta a vaga de novo; conseguindo, sai do pico (que some sozinho sem excedentes)
            retrying = true;
            void deps.peak.connections
              .acquire(tenant.tenantId, connectionId, limit)
              .then((ok) => {
                if (!ok) return void deps.peak.markPeak(tenant.tenantId).catch(() => {});
                if (released)
                  return void deps.peak.connections.release(tenant.tenantId, connectionId).catch(() => {});
                acquired = true;
                conn.write(formatSse('chat.state', { state }));
              })
              .catch(() => {})
              .finally(() => {
                retrying = false;
              });
          }
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
        releaseLeases();
      });

      conn.write(`retry: ${retryMs}\n: galaxie-sports chat\n\n`);
      conn.write(
        formatSse('chat.state', {
          state: overflow && state === 'open' ? 'read_only_peak' : state,
          ...(overflow ? { reason: 'peak' } : {}),
        }),
      );
      try {
        if (resume) {
          const r = await deps.hub.since(room, resume);
          if (!r.complete) {
            reset('Parte das mensagens desde o último lote saiu do histórico curto; releia a sala pelo GET.');
            cursor = r.latest;
          } else for (const b of r.batches) write(b);
        } else cursor = await deps.hub.latest(room);
      } catch (err) {
        // Valkey fora: a conexão fica (sem tempestade de reconexão no banco); o cliente relê a sala e segue ao vivo
        request.log.warn({ err }, 'chat SSE: histórico indisponível');
        if (resume) reset('O histórico curto está indisponível; releia a sala pelo GET.');
        cursor = { epoch: '', id: 0 };
      }
      replaying = false;
      backlog.sort((a, b) => a.id - b.id);
      for (const b of backlog.splice(0)) enqueueDelivery(b);
      await chain;
      conn.write(formatSse('ready', { last_event_id: cursor.id ? formatCursor(cursor) : null }));
    },
  );
}
