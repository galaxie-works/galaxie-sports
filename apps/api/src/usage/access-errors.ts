import { accessErrorDaily, type AccessErrorReason, type Database } from '@galaxie/db';
import { sql } from 'drizzle-orm';

import { utcDay } from './counter.js';

/** Um erro de acesso atribuível a um tenant (nunca o segredo: só o prefixo público da chave). */
export interface AccessError {
  tenantId: string;
  reason: AccessErrorReason;
  /** Prefixo público da chave; vazio quando não se aplica. */
  keyPrefix?: string | undefined;
  /** Origem recusada (chave publicável), rota (limite) ou módulo; vazio sem detalhe. */
  detail?: string | undefined;
}

export interface AccessErrorRecorderOptions {
  /** Intervalo da consolidação no Postgres (ms). Padrão 60 s. */
  intervalMs?: number;
  /** Teto de combinações distintas guardadas entre consolidações (o resto do minuto é descartado). */
  maxEntries?: number;
  /**
   * Teto de combinações distintas por tenant entre consolidações: passou, o detalhe vira `(outros)`. Assim um tenant
   * atacado (chave publicável, que é pública, com `Origin` aleatório) não toma o teto dos outros nem enche o painel.
   */
  maxPerTenant?: number;
  /** Combinações descartadas no minuto (o teto global estourou), para o log. */
  onDropped?: (dropped: number) => void;
  now?: () => Date;
  onError?: (err: unknown) => void;
}

interface Pending {
  tenantId: string;
  day: string;
  reason: AccessErrorReason;
  keyPrefix: string;
  detail: string;
  count: number;
  lastAt: Date;
}

const PREFIX_MAX = 64;
const OTHERS = '(outros)';
const FK_VIOLATION = '23503';
/** Chave da combinação; JSON para que um `|` dentro do detalhe não junte combinações diferentes. */
const keyOf = (...parts: string[]) => JSON.stringify(parts);
const DETAIL_MAX = 200;

/**
 * Texto curto e sem controle (vai para o painel do cliente e, como dado delimitado, para o prompt da Cosmos: o
 * detalhe pode vir de fora, como a origem recusada).
 */
const clean = (v: string | undefined, max: number) =>
  (v ?? '')
    // eslint-disable-next-line no-control-regex -- tira caracteres de controle de propósito
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

/**
 * Erros de acesso por tenant × dia × motivo × prefixo × detalhe (#1007), para o diagnóstico de chaves no painel.
 * Soma em memória (sem I/O na requisição) e consolida a cada minuto com `count = count + n`. Aproximado de propósito:
 * uma queda perde até um minuto, e uma rajada que passe de `maxEntries` combinações distintas no minuto (ex.: um
 * ataque com origens aleatórias) descarta o excedente em vez de crescer a memória.
 */
export class AccessErrorRecorder {
  private pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> | undefined;
  private readonly intervalMs: number;
  private readonly maxEntries: number;
  private readonly maxPerTenant: number;
  /** Combinações distintas de cada tenant desde a última consolidação. */
  private perTenant = new Map<string, number>();
  private readonly now: () => Date;
  /** Descartados por passar do teto desde a última consolidação (só para log). */
  dropped = 0;

  constructor(
    private readonly db: Database,
    private readonly options: AccessErrorRecorderOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 60_000;
    this.maxEntries = options.maxEntries ?? 5_000;
    this.maxPerTenant = options.maxPerTenant ?? 50;
    this.now = options.now ?? (() => new Date());
  }

  record(e: AccessError): void {
    const now = this.now();
    const day = utcDay(now);
    const keyPrefix = clean(e.keyPrefix, PREFIX_MAX);
    let detail = clean(e.detail, DETAIL_MAX);
    let k = keyOf(e.tenantId, day, e.reason, keyPrefix, detail);
    let hit = this.pending.get(k);
    const seen = this.perTenant.get(e.tenantId) ?? 0;
    if (!hit && seen >= this.maxPerTenant) {
      // tenant com combinações demais no minuto: o resto entra junto, sem detalhe
      detail = OTHERS;
      k = keyOf(e.tenantId, day, e.reason, keyPrefix, detail);
      hit = this.pending.get(k);
    }
    if (hit) {
      hit.count += 1;
      hit.lastAt = now;
      return;
    }
    if (this.pending.size >= this.maxEntries || seen > this.maxPerTenant) {
      this.dropped += 1;
      return;
    }
    this.perTenant.set(e.tenantId, seen + 1);
    this.pending.set(k, {
      tenantId: e.tenantId,
      day,
      reason: e.reason,
      keyPrefix,
      detail,
      count: 1,
      lastAt: now,
    });
  }

  /** Grava o que juntou. Falha devolve as contagens para a próxima consolidação (sem passar do teto). */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.pending.size) return;
    const batch = [...this.pending.values()];
    this.pending = new Map();
    this.perTenant = new Map();
    if (this.dropped) this.options.onDropped?.(this.dropped);
    this.dropped = 0;
    this.flushing = this.db
      .insert(accessErrorDaily)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          accessErrorDaily.tenantId,
          accessErrorDaily.day,
          accessErrorDaily.reason,
          accessErrorDaily.keyPrefix,
          accessErrorDaily.detail,
        ],
        set: {
          count: sql`${accessErrorDaily.count} + excluded.count`,
          lastAt: sql`greatest(${accessErrorDaily.lastAt}, excluded.last_at)`,
        },
      })
      .then(() => undefined)
      .catch((err) => {
        // tenant removido no meio (FK): o lote inteiro falharia de novo a cada minuto; descarta (é diagnóstico)
        if ((err as { code?: unknown })?.code === FK_VIOLATION) {
          this.options.onError?.(err);
          return;
        }
        // banco fora: devolve para a próxima, sem passar do teto
        for (const p of batch) {
          const k = keyOf(p.tenantId, p.day, p.reason, p.keyPrefix, p.detail);
          const hit = this.pending.get(k);
          if (hit) hit.count += p.count;
          else if (this.pending.size < this.maxEntries) this.pending.set(k, p);
        }
        this.options.onError?.(err);
      })
      .finally(() => {
        this.flushing = undefined;
      });
    return this.flushing;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    // um flush em andamento não leva o que chegou depois da troca (nem o lote devolvido se ele falhar)
    while (this.flushing) await this.flushing;
    await this.flush();
  }
}
