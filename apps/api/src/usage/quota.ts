import { utcDay, type UsageBackend } from './counter.js';

/** A partir de quanto da cota diária a resposta avisa (`x-galaxie-quota-warning`). */
export const QUOTA_WARN_RATIO = 0.8;
/** A partir de quanto da cota diária a API recusa (429 QUOTA_EXCEEDED): 10% de folga. */
export const QUOTA_BLOCK_RATIO = 1.1;

export interface QuotaStatus {
  limit: number;
  /** Requisições de produção do dia UTC, contando esta. */
  used: number;
  /** `ok` | `warn` (≥ 80%) | `blocked` (≥ 110%: esta requisição é recusada). */
  level: 'ok' | 'warn' | 'blocked';
  /** Segundos até a virada do dia UTC (retry-after do 429). */
  resetSec: number;
}

export interface QuotaGuardOptions {
  /** Por quanto tempo o total lido do Valkey vale antes de reler (ms). Padrão 5 s. */
  refreshMs?: number;
  now?: () => Date;
}

interface QuotaEntry {
  day: string;
  base: number;
  seen: number;
  at: number;
}

/**
 * Cota diária aplicada (docs/politica-de-chaves.md §4). O total do dia vem dos contadores de uso do Valkey
 * (`usage:<dia>:<tenant>`, sem as rotas `test:`), relido a cada `refreshMs`; entre leituras, a instância
 * soma as requisições que viu. O contador tem atraso de ~1 s e cada instância só soma as próprias, então o
 * corte é aproximado (a folga de 10% cobre isso).
 *
 * A releitura é uma por tenant e dia: as requisições que chegam com ela em voo esperam a mesma e contam na
 * mesma entrada. Sem isso, uma rajada com o cache frio ou vencido leria o total N vezes, cada uma com a
 * própria entrada zerada, e passaria inteira.
 */
export class QuotaGuard {
  private readonly cache = new Map<string, QuotaEntry>();
  private readonly refreshing = new Map<string, Promise<QuotaEntry>>();
  private readonly refreshMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly backend: UsageBackend,
    options: QuotaGuardOptions = {},
  ) {
    this.refreshMs = options.refreshMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
  }

  /** Conta esta requisição e diz em que nível o tenant está. Erro do Valkey propaga (o chamador decide). */
  async check(tenantId: string, limit: number): Promise<QuotaStatus> {
    const now = this.now();
    const day = utcDay(now);
    let entry = this.cache.get(tenantId);
    if (!entry || entry.day !== day || now.getTime() - entry.at >= this.refreshMs)
      entry = await this.refresh(tenantId, day, now);
    // daqui até o fim não há await: a contagem e a decisão de cada requisição não se intercalam
    entry.seen += 1;
    const used = entry.base + entry.seen;
    const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const resetSec = Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000));
    const level =
      used > limit * QUOTA_BLOCK_RATIO ? 'blocked' : used >= limit * QUOTA_WARN_RATIO ? 'warn' : 'ok';
    // requisição recusada não conta (nem no contador de uso)
    if (level === 'blocked') entry.seen -= 1;
    return { limit, used, level, resetSec };
  }

  /** Relê o total do dia; quem chega com a releitura em voo recebe a mesma entrada. */
  private refresh(tenantId: string, day: string, now: Date): Promise<QuotaEntry> {
    const key = `${tenantId}|${day}`;
    const inFlight = this.refreshing.get(key);
    if (inFlight) return inFlight;
    const p = this.backend
      .get(day, tenantId)
      .then((counts) => {
        const base = Object.entries(counts)
          .filter(([route]) => !route.startsWith('test:'))
          .reduce((sum, [, n]) => sum + n, 0);
        if (this.cache.size >= 10_000) this.cache.clear();
        const entry: QuotaEntry = { day, base, seen: 0, at: now.getTime() };
        this.cache.set(tenantId, entry);
        return entry;
      })
      .finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, p);
    return p;
  }
}
