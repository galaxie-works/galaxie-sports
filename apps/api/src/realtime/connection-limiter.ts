import type { Redis } from 'ioredis';

/**
 * Limite de conexões SSE simultâneas por tenant. Cada conexão é um "lease" renovado no heartbeat;
 * se a instância morrer sem liberar, o lease expira sozinho (`leaseMs`).
 */
export interface ConnectionLimiter {
  /** true se a conexão coube no limite (e foi registrada). */
  acquire(tenantId: string, connectionId: string, limit: number): Promise<boolean>;
  renew(tenantId: string, connectionId: string): Promise<void>;
  release(tenantId: string, connectionId: string): Promise<void>;
}

// Remove leases vencidos, verifica o limite e registra a conexão — atômico no Valkey.
const ACQUIRE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1`;

/** Contagem no Valkey (sorted set por tenant, score = expiração): vale para todas as instâncias. */
export class RedisConnectionLimiter implements ConnectionLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
    private readonly leaseMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private key(tenantId: string): string {
    return `${this.prefix}sse:conns:${tenantId}`;
  }

  async acquire(tenantId: string, connectionId: string, limit: number): Promise<boolean> {
    const t = this.now();
    const ok = await this.redis.eval(
      ACQUIRE_SCRIPT,
      1,
      this.key(tenantId),
      t,
      t + this.leaseMs,
      limit,
      connectionId,
      this.leaseMs * 2,
    );
    return ok === 1;
  }

  async renew(tenantId: string, connectionId: string): Promise<void> {
    const k = this.key(tenantId);
    await this.redis
      .multi()
      .zadd(k, 'XX', this.now() + this.leaseMs, connectionId)
      .pexpire(k, this.leaseMs * 2)
      .exec();
  }

  async release(tenantId: string, connectionId: string): Promise<void> {
    await this.redis.zrem(this.key(tenantId), connectionId);
  }
}

/** Em memória (sem Valkey): limite por instância. */
export class MemoryConnectionLimiter implements ConnectionLimiter {
  private readonly conns = new Map<string, Set<string>>();

  async acquire(tenantId: string, connectionId: string, limit: number): Promise<boolean> {
    const set = this.conns.get(tenantId) ?? new Set<string>();
    if (set.size >= limit) return false;
    set.add(connectionId);
    this.conns.set(tenantId, set);
    return true;
  }

  async renew(): Promise<void> {}

  async release(tenantId: string, connectionId: string): Promise<void> {
    this.conns.get(tenantId)?.delete(connectionId);
  }
}
