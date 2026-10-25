import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { resolveTopic, StreamQuery, type ChangeTopic, type RealtimeChange } from '@galaxie/contracts';
import { changeFeed, changeFeedPrune, type Database } from '@galaxie/db';
import { assertModule, assertSport, type TenantContext } from '../auth/authenticator.js';
import { ProblemError, problems } from '../errors.js';
import { parseInput } from '../util.js';
import { RecentIds, type ChangeStream } from './change-stream.js';
import {
  scopeChange,
  toRealtimeChange,
  topicsForTenant,
  TOPIC_MODULE,
  type ChangeFilter,
} from './changes.js';
import type { ConnectionLimiter } from './connection-limiter.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Aceita a chave também em `?key=` (clientes EventSource não enviam headers). */
    allowQueryKey?: boolean;
  }
}

export interface SseOptions {
  /** Conexões SSE simultâneas por tenant (todas as instâncias, via Valkey). Padrão 100. */
  maxConnectionsPerTenant?: number;
  /** Intervalo do heartbeat (comentário SSE). Padrão 15 s. */
  heartbeatMs?: number;
  /** Bytes enfileirados para um cliente lento antes de derrubar a conexão. Padrão 1 MiB. */
  maxBufferBytes?: number;
  /** Máximo de mudanças reenviadas na retomada (Last-Event-ID). Padrão 5000. */
  maxReplay?: number;
  /** Sugestão de espera para reconexão (campo `retry:`). Padrão 3 s. */
  retryMs?: number;
}

interface StreamDeps {
  db: Database;
  stream: ChangeStream;
  limiter: ConnectionLimiter;
  options: SseOptions;
}

/** Formata uma mensagem SSE (`data:` em uma linha: o JSON não tem quebras). */
export function formatSse(event: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Conexão SSE com controle de pressão: se o socket não esvazia (`write` → false), as mensagens
 * ficam numa fila limitada; estourou `maxBufferBytes`, a conexão cai e o cliente retoma do banco
 * com Last-Event-ID — um cliente lento nunca segura memória da API.
 */
export class SseConnection {
  private readonly queue: string[] = [];
  private queuedBytes = 0;
  private congested = false;
  private readonly sent = new RecentIds(5_000);
  closed = false;

  constructor(
    private readonly res: ServerResponse,
    private readonly maxBufferBytes: number,
    private readonly onOverflow: () => void,
  ) {}

  get bufferedBytes(): number {
    return this.queuedBytes;
  }

  write(chunk: string): void {
    if (this.closed) return;
    if (this.congested) {
      this.queue.push(chunk);
      this.queuedBytes += Buffer.byteLength(chunk);
      if (this.queuedBytes > this.maxBufferBytes) this.onOverflow();
      return;
    }
    if (!this.res.write(chunk)) this.waitDrain();
  }

  /** Envia a mudança uma única vez (replay e ao vivo podem se sobrepor). */
  send(change: RealtimeChange): void {
    if (!this.sent.add(change.id)) return;
    this.write(formatSse(change.topic, change, change.id));
  }

  /** Encerra o stream e o socket (um stream SSE nunca devolve a conexão ao keep-alive). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    // guarda o socket antes: ao terminar a resposta, o Node o desassocia de `res`
    const socket = this.res.socket;
    this.res.end(() => socket?.destroy());
  }

  /** Derruba sem esperar o buffer (cliente lento). */
  destroy(): void {
    this.closed = true;
    this.queue.length = 0;
    this.res.destroy();
  }

  private waitDrain(): void {
    this.congested = true;
    this.res.once('drain', () => this.flush());
  }

  private flush(): void {
    this.congested = false;
    while (this.queue.length && !this.closed) {
      const chunk = this.queue.shift()!;
      this.queuedBytes -= Buffer.byteLength(chunk);
      if (!this.res.write(chunk)) return this.waitDrain();
    }
  }
}

/** Remove `key=` de URLs antes de irem para logs (chave enviada por EventSource). */
export function redactKey(url: string): string {
  return url.replace(/([?&]key=)[^&#]*/gi, '$1[redacted]');
}

/**
 * `GET /v1/stream` — Server-Sent Events filtrados por eventos, competições, esportes e tópicos.
 * Ver docs/05 §5.1.
 */
export async function streamRoutes(app: FastifyInstance, deps: StreamDeps): Promise<Set<SseConnection>> {
  const open = new Set<SseConnection>();
  const maxConnections = deps.options.maxConnectionsPerTenant ?? 100;
  const heartbeatMs = deps.options.heartbeatMs ?? 15_000;
  const maxBufferBytes = deps.options.maxBufferBytes ?? 1024 * 1024;
  const maxReplay = deps.options.maxReplay ?? 5_000;
  const retryMs = deps.options.retryMs ?? 3_000;

  app.get(
    '/v1/stream',
    { config: { module: 'core_data', allowQueryKey: true } },
    async (request, reply): Promise<void> => {
      const q = parseInput(StreamQuery, request.query);
      let tenant = request.tenant!;

      const topics: ChangeTopic[] = q.topics.length
        ? [...new Set(q.topics.map((t) => resolveTopic(t)!))]
        : topicsForTenant(tenant);
      const assertAccess = (ctx: TenantContext) => {
        assertModule(ctx, 'core_data');
        for (const t of topics) assertModule(ctx, TOPIC_MODULE[t]);
        for (const s of q.sports) assertSport(ctx, s);
      };
      assertAccess(tenant);

      const header = request.headers['last-event-id'];
      const headerId = Array.isArray(header) ? header[0] : header;
      if (headerId != null && headerId !== '' && !/^\d+$/.test(headerId))
        throw problems.invalidParams([
          { path: 'Last-Event-ID', message: 'deve ser o id numérico de uma mudança' },
        ]);
      const lastEventId = headerId ? Number(headerId) : q.last_event_id;

      const filter: ChangeFilter = {
        topics: new Set(topics),
        events: new Set(q.events.map((e) => e.toLowerCase())),
        competitions: new Set(q.competitions.map((c) => c.toLowerCase())),
        sports: new Set(q.sports),
      };

      // o cliente pode cair enquanto o acquire espera o Valkey: o 'close' dispara antes de existir o
      // cleanup, e sem esta marca o heartbeat renovaria o lease (vaga do tenant) para sempre
      const res = reply.raw;
      let clientGone = false;
      const onEarlyClose = () => {
        clientGone = true;
      };
      res.once('close', onEarlyClose);
      const connectionId = randomUUID();
      const acquired = await deps.limiter
        .acquire(tenant.tenantId, connectionId, maxConnections)
        .catch((err: unknown) => {
          // Valkey fora: não derruba o tempo real (fail-open), como o rate limit
          request.log.warn({ err }, 'limite de conexões SSE indisponível');
          return true;
        });
      res.off('close', onEarlyClose);
      if (clientGone || res.destroyed) {
        if (acquired) deps.limiter.release(tenant.tenantId, connectionId).catch(() => {});
        reply.hijack();
        res.destroy();
        return;
      }
      if (!acquired)
        throw new ProblemError(
          429,
          'RATE_LIMITED',
          'Limite de conexões simultâneas do tenant atingido',
          `Máximo de ${maxConnections} conexões SSE abertas por tenant.`,
          { headers: { 'retry-after': '30' } },
        );

      // a partir daqui a resposta é nossa (stream longo): o hijack pula os hooks onSend, então os
      // headers de segurança e de CORS (EventSource de outra origem) vão aqui, à mão
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
      });
      request.raw.socket.setNoDelay(true);

      const conn = new SseConnection(res, maxBufferBytes, () => {
        request.log.warn(
          { tenant: tenant.slug, buffered: conn.bufferedBytes },
          'SSE: cliente lento desconectado',
        );
        conn.destroy();
      });
      open.add(conn);

      let replaying = true;
      const backlog: RealtimeChange[] = [];
      const deliver = (change: RealtimeChange) => {
        const scoped = scopeChange(change, filter, tenant);
        if (!scoped) return;
        if (replaying) backlog.push(scoped);
        else conn.send(scoped);
      };
      const unsubscribe = deps.stream.subscribe(deliver);

      // revalida a chave a cada heartbeat (o autenticador cacheia por 60 s): chave revogada, tenant
      // suspenso ou módulo retirado encerram o stream; banco fora não derruba (fail-open)
      const revalidate = async () => {
        if (!request.reauthenticate || conn.closed) return;
        try {
          const ctx = await request.reauthenticate();
          assertAccess(ctx);
          if (ctx.tenantId === tenant.tenantId) tenant = ctx;
        } catch (err) {
          if (!(err instanceof ProblemError) || err.status >= 500 || err.status === 429) return;
          request.log.info({ tenant: tenant.slug, code: err.code }, 'SSE: acesso revogado, encerrando');
          conn.write(formatSse('access_revoked', { code: err.code, message: err.title, detail: err.detail }));
          conn.close();
        }
      };
      const heartbeat = setInterval(() => {
        conn.write(`: hb ${Date.now()}\n\n`);
        deps.limiter.renew(tenant.tenantId, connectionId).catch(() => {});
        void revalidate();
      }, heartbeatMs);
      heartbeat.unref();

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        open.delete(conn);
        conn.closed = true;
        deps.limiter.release(tenant.tenantId, connectionId).catch(() => {});
      };
      res.on('close', cleanup);

      conn.write(`retry: ${retryMs}\n: galaxie-sports stream\n\n`);
      try {
        let resumeFrom = await deps.stream.latestId();
        let truncated: 'max_replay' | 'retention' | null = null;
        if (lastEventId != null) {
          const r = await replay(deps.db, lastEventId, filter, maxReplay, (c) => {
            const scoped = scopeChange(c, filter, tenant);
            if (scoped) conn.send(scoped);
          });
          truncated = r.truncated;
          resumeFrom = Math.max(resumeFrom, r.lastId);
        }
        replaying = false;
        backlog.sort((a, b) => Number(a.id) - Number(b.id));
        for (const c of backlog.splice(0)) conn.send(c);
        if (truncated)
          conn.write(
            formatSse('replay_truncated', {
              reason: truncated,
              message:
                truncated === 'retention'
                  ? 'Parte das mudanças desde o Last-Event-ID já saiu da retenção do change feed; recarregue o estado pela API REST.'
                  : 'Muitas mudanças desde o Last-Event-ID; recarregue o estado pela API REST.',
            }),
          );
        conn.write(formatSse('ready', { last_event_id: String(resumeFrom), topics }));
      } catch (err) {
        request.log.warn({ err }, 'SSE: falha na retomada');
        conn.close();
      }
    },
  );

  return open;
}

/**
 * Reenvia as mudanças após `afterId` (Last-Event-ID), em ordem, até `max`. `truncated`: `max_replay` se
 * parou no teto; `retention` se `afterId` está abaixo da marca da poda (`ops.change_feed_prune`), ou seja,
 * parte do que veio depois dele já foi apagado pela retenção (o que restou é reenviado mesmo assim).
 */
async function replay(
  db: Database,
  afterId: number,
  filter: ChangeFilter,
  max: number,
  send: (change: RealtimeChange) => void,
): Promise<{ lastId: number; truncated: 'max_replay' | 'retention' | null }> {
  const [mark] = await db
    .select({ maxDeletedId: changeFeedPrune.maxDeletedId })
    .from(changeFeedPrune)
    .where(eq(changeFeedPrune.name, 'default'));
  const pruned = mark != null && afterId < mark.maxDeletedId;
  let cursor = afterId;
  let sent = 0;
  const events = filter.events?.size ? [...filter.events] : undefined;
  for (;;) {
    const rows = await db
      .select()
      .from(changeFeed)
      .where(
        and(
          gt(changeFeed.id, cursor),
          inArray(changeFeed.topic, [...filter.topics]),
          events ? inArray(sql`${changeFeed.payload}->>'event_id'`, events) : undefined,
        ),
      )
      .orderBy(asc(changeFeed.id))
      .limit(500);
    for (const row of rows) {
      const change = toRealtimeChange(row);
      cursor = row.id;
      if (!change) continue;
      if (sent >= max) return { lastId: cursor, truncated: 'max_replay' };
      send(change);
      sent += 1;
    }
    if (rows.length < 500) return { lastId: cursor, truncated: pruned ? 'retention' : null };
  }
}
