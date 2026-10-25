import type { Redis } from 'ioredis';

/**
 * Chaves que já acertaram o segredo em alguma instância (sha256 da chave completa, nunca a chave). Servem só
 * para não aplicar a uma chave legítima o limite de tentativas por prefixo (nem por IP) e para devolver o
 * motivo exato de um 401 (revogada, expirada, suspensa) a quem tem a chave. **Não** dispensam o scrypt: quem
 * escreve no Valkey não ganha acesso.
 */
export interface VerifiedKeyStore {
  has(keyHash: string): Promise<boolean>;
  /** Registra (ou renova) por `ttlMs`. */
  add(keyHash: string, ttlMs: number): Promise<void>;
}

/** No Valkey: compartilhado entre instâncias (instância nova ou reiniciada já conhece as chaves em uso). */
export class RedisVerifiedKeyStore implements VerifiedKeyStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {}

  async has(keyHash: string): Promise<boolean> {
    return (await this.redis.exists(`${this.prefix}auth:ok:${keyHash}`)) === 1;
  }

  async add(keyHash: string, ttlMs: number): Promise<void> {
    await this.redis.set(`${this.prefix}auth:ok:${keyHash}`, '1', 'PX', ttlMs);
  }
}

/** Em memória (testes e desenvolvimento sem Valkey). */
export class MemoryVerifiedKeyStore implements VerifiedKeyStore {
  private readonly keys = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async has(keyHash: string): Promise<boolean> {
    return (this.keys.get(keyHash) ?? 0) > this.now();
  }

  async add(keyHash: string, ttlMs: number): Promise<void> {
    if (this.keys.size >= 10_000) this.keys.clear();
    this.keys.set(keyHash, this.now() + ttlMs);
  }
}
