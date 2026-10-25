import { and, asc, eq, gt, notInArray, sql } from 'drizzle-orm';
import {
  CHANGE_FEED_CHANNEL,
  changeFeed,
  tenant,
  webhookCursor,
  webhookDelivery,
  webhookEndpoint,
  type Database,
} from '@galaxie/db';
import type { ChangeTopic } from '@galaxie/contracts';
import {
  scopeChange,
  toRealtimeChange,
  topicsForTenant,
  type ChangeFilter,
  type TenantScope,
} from '../realtime/changes.js';
import { GapCursor } from '../realtime/gap-cursor.js';
import { WebhookSecretBox } from './secret-box.js';
import { SIGNATURE_HEADER, signWebhook } from './signature.js';
import { postWebhook } from './transport.js';

interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface WebhookWorkerOptions {
  /** Tentativas até a entrega ir para a DLQ (`dead`). Padrão 10. */
  maxAttempts?: number;
  /** Atraso da 1ª retentativa; dobra a cada falha (±20% de jitter). Padrão 10 s. */
  baseDelayMs?: number;
  /** Teto do atraso entre tentativas. Padrão 1 h. */
  maxDelayMs?: number;
  /** Timeout de cada POST. Padrão 10 s. */
  timeoutMs?: number;
  /** Entregas reivindicadas por ciclo. Padrão 50. */
  batchSize?: number;
  /** POSTs simultâneos. Padrão 10. */
  concurrency?: number;
  /** Varredura além do NOTIFY. Padrão 1 s. */
  pollIntervalMs?: number;
  gapTimeoutMs?: number;
  listen?: boolean;
  /** Nome do cursor em api.webhook_cursor. Padrão `default`. */
  cursorName?: string;
  /** KEK dos segredos (padrão: `WEBHOOK_SIGNING_SECRET` do ambiente). Legados em texto puro valem sem ela. */
  secrets?: WebhookSecretBox;
  /**
   * Entrega em rede privada/loopback (WEBHOOK_ALLOW_PRIVATE_TARGETS; só desenvolvimento e testes). Padrão
   * false: destino que resolve para IP privado, link-local (metadata) ou reservado falha a tentativa.
   */
  allowPrivateTargets?: boolean;
  /** Transporte do POST (padrão: postWebhook, com a checagem de destino no socket). */
  post?: typeof postWebhook;
  logger?: Logger;
}

export interface DeliveryStats {
  delivered: number;
  failed: number;
  dead: number;
}

const BATCH = 500;
const USER_AGENT = 'galaxie-sports-webhooks/0.1';

type ClaimedDelivery = {
  id: string;
  endpoint_id: string;
  change_id: string;
  topic: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
  active: boolean;
  tenant_status: string;
};

/** Atraso exponencial com jitter de ±20%. */
export function retryDelayMs(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.8 + 0.4 * random()));
}

/**
 * Worker de webhooks (entrypoint `pnpm --filter @galaxie/api webhooks:worker`), separado da API para
 * que entregas lentas nunca disputem recursos com as requisições.
 *
 * 1. **Enfileira**: lê `ops.change_feed` (NOTIFY + varredura, cursor em `api.webhook_cursor`) e cria
 *    uma `api.webhook_delivery` por mudança × endpoint compatível (tópicos, filtros e contrato do
 *    tenant). Idempotente (único por endpoint × mudança); só um worker enfileira por vez
 *    (`FOR UPDATE SKIP LOCKED` no cursor).
 * 2. **Entrega**: reivindica entregas vencidas (`FOR UPDATE SKIP LOCKED` + lease), faz o POST assinado
 *    e registra o resultado. Falha → retentativa exponencial; após `maxAttempts`, `dead` (DLQ).
 */
export class WebhookWorker {
  private cursor: GapCursor | undefined;
  private timer: NodeJS.Timeout | undefined;
  private unlisten: (() => Promise<void>) | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private stopped = true;
  private readonly post: typeof postWebhook;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly cursorName: string;
  private readonly secrets: WebhookSecretBox;

  constructor(
    private readonly db: Database,
    private readonly options: WebhookWorkerOptions = {},
  ) {
    this.post = options.post ?? postWebhook;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.baseDelayMs = options.baseDelayMs ?? 10_000;
    this.maxDelayMs = options.maxDelayMs ?? 3_600_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.batchSize = options.batchSize ?? 50;
    this.concurrency = options.concurrency ?? 10;
    this.cursorName = options.cursorName ?? 'default';
    this.secrets = options.secrets ?? WebhookSecretBox.fromEnv();
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (this.options.listen !== false) {
      const sub = await this.db.$client.listen(CHANGE_FEED_CHANNEL, () => void this.tick());
      this.unlisten = () => sub.unlisten();
    }
    this.timer = setInterval(() => void this.tick(), this.options.pollIntervalMs ?? 1_000);
    await this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.unlisten?.().catch(() => {});
    await this.running;
  }

  /** Um ciclo (enfileirar + entregar); chamadas concorrentes são coalescidas. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.pending = true;
      return this.running;
    }
    this.running = this.cycle()
      .catch((err) => this.options.logger?.warn({ err }, 'webhooks: falha no ciclo'))
      .finally(() => {
        this.running = undefined;
        if (this.pending && !this.stopped) {
          this.pending = false;
          void this.tick();
        }
      });
    return this.running;
  }

  /** Espera o ciclo em andamento e os coalescidos atrás dele (testes e desligamento). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async cycle(): Promise<void> {
    await this.enqueue();
    for (;;) {
      const stats = await this.deliverDue();
      if (stats.delivered + stats.failed + stats.dead < this.batchSize || this.stopped) return;
    }
  }

  /** Transforma mudanças novas do change feed em entregas. Devolve quantas entregas criou. */
  async enqueue(): Promise<number> {
    return this.db.transaction(async (tx) => {
      // primeiro uso: começa do fim do change feed (webhooks não reenviam o histórico)
      await tx
        .insert(webhookCursor)
        .values({
          name: this.cursorName,
          lastChangeId: sql`coalesce((select max(id) from ops.change_feed), 0)`,
        })
        .onConflictDoNothing();
      const [state] = await tx
        .select()
        .from(webhookCursor)
        .where(eq(webhookCursor.name, this.cursorName))
        .for('update', { skipLocked: true });
      if (!state) return 0; // outro worker está enfileirando
      if (!this.cursor || state.lastChangeId > this.cursor.floor)
        this.cursor = new GapCursor(state.lastChangeId, {
          ...(this.options.gapTimeoutMs != null ? { gapTimeoutMs: this.options.gapTimeoutMs } : {}),
        });
      const cursor = this.cursor;

      const endpoints = (
        await tx
          .select({ endpoint: webhookEndpoint, tenant })
          .from(webhookEndpoint)
          .innerJoin(tenant, eq(tenant.id, webhookEndpoint.tenantId))
          .where(and(eq(webhookEndpoint.active, true), eq(tenant.status, 'active')))
      ).map(({ endpoint, tenant: t }) => {
        const scope: TenantScope = { modules: t.modules, markets: t.markets, sports: t.sports };
        const filter: ChangeFilter = {
          topics: new Set<ChangeTopic>(endpoint.topics.length ? endpoint.topics : topicsForTenant(scope)),
          events: new Set(endpoint.filters.events ?? []),
          competitions: new Set(endpoint.filters.competitions ?? []),
          sports: new Set(endpoint.filters.sports ?? []),
        };
        return { id: endpoint.id, scope, filter };
      });

      let created = 0;
      for (;;) {
        const seen = cursor.seenIds;
        const rows = await tx
          .select()
          .from(changeFeed)
          .where(
            and(gt(changeFeed.id, cursor.floor), seen.length ? notInArray(changeFeed.id, seen) : undefined),
          )
          .orderBy(asc(changeFeed.id))
          .limit(BATCH);
        const deliveries = [];
        for (const row of rows) {
          const change = toRealtimeChange(row);
          if (!change) continue;
          for (const ep of endpoints) {
            const scoped = scopeChange(change, ep.filter, ep.scope);
            if (scoped)
              deliveries.push({ endpointId: ep.id, changeId: row.id, topic: scoped.topic, payload: scoped });
          }
        }
        if (deliveries.length) {
          const inserted = await tx
            .insert(webhookDelivery)
            .values(deliveries)
            .onConflictDoNothing()
            .returning({ id: webhookDelivery.id });
          created += inserted.length;
        }
        cursor.mark(rows.map((r) => r.id));
        if (rows.length < BATCH) break;
      }
      cursor.advance();
      await tx
        .update(webhookCursor)
        .set({ lastChangeId: cursor.floor, updatedAt: new Date() })
        .where(eq(webhookCursor.name, this.cursorName));
      return created;
    });
  }

  /** Entrega o lote de entregas vencidas. */
  async deliverDue(): Promise<DeliveryStats> {
    const leaseSec = Math.ceil(this.timeoutMs / 1000) + 30;
    // reivindica com lease: se o worker morrer no meio, a entrega volta a vencer sozinha
    const claimed = await this.db.execute<ClaimedDelivery>(sql`
      update api.webhook_delivery d
         set next_retry_at = now() + make_interval(secs => ${leaseSec})
        from api.webhook_endpoint e
        join api.tenant t on t.id = e.tenant_id
       where e.id = d.endpoint_id
         and d.id in (
           select id from api.webhook_delivery
            where status = 'pending' and next_retry_at <= now()
            order by next_retry_at, id
            limit ${this.batchSize}
            for update skip locked)
      returning d.id::text, d.endpoint_id, d.change_id::text, d.topic, d.payload, d.attempts,
                e.url, e.secret, e.active, t.status::text as tenant_status`);
    const stats: DeliveryStats = { delivered: 0, failed: 0, dead: 0 };
    const queue = [...claimed];
    const work = async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        const outcome = await this.deliver(d);
        stats[outcome] += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, work));
    return stats;
  }

  private async deliver(d: ClaimedDelivery): Promise<keyof DeliveryStats> {
    const id = Number(d.id);
    const attempts = d.attempts + 1;
    // endpoint desativado ou tenant suspenso depois do enfileiramento: nada é enviado (replay pela DLQ)
    const off = !d.active ? 'endpoint desativado' : d.tenant_status !== 'active' ? 'tenant suspenso' : null;
    if (off) {
      await this.db
        .update(webhookDelivery)
        .set({ status: 'dead', lastError: off })
        .where(eq(webhookDelivery.id, id));
      return 'dead';
    }
    const body = JSON.stringify(d.payload);
    const t = Math.floor(Date.now() / 1000);
    let responseCode: number | null = null;
    let error: string;
    try {
      // decifra só aqui, no momento de assinar (sem KEK, segredo cifrado vira erro desta tentativa)
      const secret = this.secrets.open(d.secret, d.endpoint_id);
      responseCode = await this.post(d.url, {
        headers: {
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
          [SIGNATURE_HEADER]: signWebhook(secret, body, t),
          'x-galaxie-event': d.topic,
          'x-galaxie-delivery': d.id,
          'x-galaxie-attempt': String(attempts),
          // estável entre retentativas: o receptor descarta duplicatas por ela
          'idempotency-key': `${d.endpoint_id}:${d.change_id}`,
        },
        body,
        timeoutMs: this.timeoutMs,
        allowPrivateTargets: this.options.allowPrivateTargets ?? false,
      });
      if (responseCode >= 200 && responseCode < 300) {
        await this.db
          .update(webhookDelivery)
          .set({
            status: 'delivered',
            attempts,
            responseCode,
            lastError: null,
            lastAttemptAt: new Date(),
            deliveredAt: new Date(),
          })
          .where(eq(webhookDelivery.id, id));
        return 'delivered';
      }
      error = `HTTP ${responseCode}`;
    } catch (err) {
      error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }

    const dead = attempts >= this.maxAttempts;
    await this.db
      .update(webhookDelivery)
      .set({
        status: dead ? 'dead' : 'pending',
        attempts,
        responseCode,
        lastError: error.slice(0, 500),
        lastAttemptAt: new Date(),
        ...(dead
          ? {}
          : {
              nextRetryAt: new Date(Date.now() + retryDelayMs(attempts, this.baseDelayMs, this.maxDelayMs)),
            }),
      })
      .where(eq(webhookDelivery.id, id));
    if (dead)
      this.options.logger?.warn(
        { delivery: id, endpoint: d.endpoint_id, attempts, error },
        'webhooks: entrega enviada para a DLQ',
      );
    return dead ? 'dead' : 'failed';
  }
}
