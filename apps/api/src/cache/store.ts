import type { Redis } from 'ioredis';

/** Resposta pronta guardada no cache (corpo já serializado + validador). */
export interface CachedResponse {
  status: number;
  body: string;
  etag: string;
  tags: string[];
  /** Headers extras a reproduzir (ex.: x-galaxie-source do espelho). */
  headers?: Record<string, string>;
  /** Content-Type quando o corpo não é JSON (ex.: text/calendar). */
  contentType?: string;
  /** Metadados internos, não enviados (ex.: esporte do evento, para checar o plano no HIT). */
  meta?: Record<string, string>;
  storedAt: number;
  /**
   * TTL efetivo (s) com que a entrada foi gravada (o da rota ou o do `load`, ex.: 10 s ao vivo). No HIT, o
   * Cache-Control usa o que resta dele. Ausente em entradas gravadas antes deste campo.
   */
  ttl?: number;
}

/** Cache de respostas por chave, com invalidação por tag (purge). */
export interface ResponseCache {
  get(key: string): Promise<CachedResponse | undefined>;
  set(key: string, value: CachedResponse, ttlSec: number): Promise<void>;
  /** Remove todas as entradas marcadas com qualquer uma das tags. Retorna quantas chaves caíram. */
  purgeTags(tags: string[]): Promise<number>;
}

/** Tempo de vida dos índices de tag: maior que o maior TTL servido (24 h). */
const TAG_TTL_SEC = 2 * 24 * 3600;

export class RedisResponseCache implements ResponseCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {}

  private key(k: string) {
    return `${this.prefix}cache:${k}`;
  }
  private tagKey(tag: string) {
    return `${this.prefix}tag:${tag}`;
  }

  async get(key: string): Promise<CachedResponse | undefined> {
    const raw = await this.redis.get(this.key(key));
    return raw ? (JSON.parse(raw) as CachedResponse) : undefined;
  }

  async set(key: string, value: CachedResponse, ttlSec: number): Promise<void> {
    if (ttlSec <= 0) return;
    const k = this.key(key);
    const tx = this.redis.multi().set(k, JSON.stringify(value), 'EX', Math.ceil(ttlSec));
    for (const tag of value.tags) tx.sadd(this.tagKey(tag), k).expire(this.tagKey(tag), TAG_TTL_SEC);
    await tx.exec();
  }

  async purgeTags(tags: string[]): Promise<number> {
    let purged = 0;
    for (const tag of new Set(tags)) {
      const tk = this.tagKey(tag);
      const members = await this.redis.smembers(tk);
      if (members.length) purged += await this.redis.del(...members);
      await this.redis.del(tk);
    }
    return purged;
  }
}

/** Cache em memória (testes e desenvolvimento sem Valkey). */
export class MemoryResponseCache implements ResponseCache {
  private readonly entries = new Map<string, { value: CachedResponse; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<CachedResponse | undefined> {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  async set(key: string, value: CachedResponse, ttlSec: number): Promise<void> {
    if (ttlSec <= 0) return;
    if (this.entries.size > 5_000) this.entries.clear();
    this.entries.set(key, { value, expiresAt: this.now() + ttlSec * 1000 });
  }

  async purgeTags(tags: string[]): Promise<number> {
    const wanted = new Set(tags);
    let purged = 0;
    for (const [k, e] of this.entries) {
      if (e.value.tags.some((t) => wanted.has(t))) {
        this.entries.delete(k);
        purged += 1;
      }
    }
    return purged;
  }
}
