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
  /**
   * Grava a entrada. Com `since` (a `purgeMark()` lida antes de montar a resposta), recusa a gravação se
   * alguma tag dela foi purgada depois disso: a resposta pode ter sido lida do banco antes da mudança que
   * motivou o purge. Retorna se gravou.
   */
  set(key: string, value: CachedResponse, ttlSec: number, since?: number): Promise<boolean>;
  /** Remove todas as entradas marcadas com qualquer uma das tags. Retorna quantas chaves caíram. */
  purgeTags(tags: string[]): Promise<number>;
  /** Marca d'água dos purges (cresce a cada `purgeTags`); leia antes do load e passe a `set`. */
  purgeMark(): Promise<number>;
}

/** Tempo de vida dos índices de tag: maior que o maior TTL servido (24 h). */
const TAG_TTL_SEC = 2 * 24 * 3600;

/**
 * Por quanto tempo a marca do último purge de uma tag é lembrada: bem acima da duração de um load (o
 * timeout da requisição é 30 s).
 */
const PURGE_MARK_TTL_SEC = 300;

/**
 * Grava a entrada e a indexa nas tags numa operação atômica com a checagem das marcas de purge (um purge
 * nunca cai entre a checagem e a gravação). KEYS = [entrada, ...marcas das tags, ...índices das tags];
 * ARGV = [valor, ttl, since ('' = sem checagem), nº de tags, ttl dos índices].
 */
const SET_SCRIPT = `
local n = tonumber(ARGV[4])
if ARGV[3] ~= '' then
  local since = tonumber(ARGV[3])
  for i = 1, n do
    local mark = redis.call('GET', KEYS[1 + i])
    if mark and tonumber(mark) > since then return 0 end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
for i = 1, n do
  local idx = KEYS[1 + n + i]
  redis.call('SADD', idx, KEYS[1])
  redis.call('EXPIRE', idx, ARGV[5])
end
return 1
`;

/** Nome do comando do script no cliente (defineCommand: EVALSHA, com EVAL só quando o Valkey não tem o script). */
const SET_COMMAND = 'galaxieCacheSet';
type CacheSetCommand = (numKeys: number, ...args: (string | number)[]) => Promise<number>;

/**
 * Cache de respostas no Valkey. A checagem de purge durante o load depende de `<prefixo>purge-seq` só crescer.
 * Se a chave sumir (Valkey reiniciado sem persistência, eviction, limpeza manual), ela recomeça do 0 e as
 * marcas ainda vivas (até 5 min) podem ser maiores que a marca lida: a gravação dessas tags é recusada à toa
 * (a resposta sai sem cache, nunca errada). Uma marca lida antes do sumiço e maior que as novas deixa passar
 * uma gravação que devia ser recusada: volta, por uma janela de load, ao comportamento sem a checagem.
 */
export class RedisResponseCache implements ResponseCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'gs:',
  ) {
    if (typeof (redis as unknown as Record<string, unknown>)[SET_COMMAND] !== 'function')
      redis.defineCommand(SET_COMMAND, { lua: SET_SCRIPT });
  }

  private key(k: string) {
    return `${this.prefix}cache:${k}`;
  }
  private tagKey(tag: string) {
    return `${this.prefix}tag:${tag}`;
  }
  private markKey(tag: string) {
    return `${this.prefix}purged:${tag}`;
  }
  private seqKey() {
    return `${this.prefix}purge-seq`;
  }

  async get(key: string): Promise<CachedResponse | undefined> {
    const raw = await this.redis.get(this.key(key));
    return raw ? (JSON.parse(raw) as CachedResponse) : undefined;
  }

  async set(key: string, value: CachedResponse, ttlSec: number, since?: number): Promise<boolean> {
    if (ttlSec <= 0) return false;
    const tags = [...new Set(value.tags)];
    const command = (this.redis as unknown as Record<string, CacheSetCommand>)[SET_COMMAND]!;
    const ok = await command.call(
      this.redis,
      1 + 2 * tags.length,
      this.key(key),
      ...tags.map((t) => this.markKey(t)),
      ...tags.map((t) => this.tagKey(t)),
      JSON.stringify(value),
      Math.ceil(ttlSec),
      since == null ? '' : String(since),
      tags.length,
      TAG_TTL_SEC,
    );
    return ok === 1;
  }

  async purgeTags(tags: string[]): Promise<number> {
    const unique = [...new Set(tags)];
    if (!unique.length) return 0;
    // marca antes de apagar: o load que começou antes do purge e grava depois dele é recusado em `set`
    const seq = await this.redis.incr(this.seqKey());
    const marks = this.redis.multi();
    for (const tag of unique) marks.set(this.markKey(tag), seq, 'EX', PURGE_MARK_TTL_SEC);
    await marks.exec();
    let purged = 0;
    for (const tag of unique) {
      const tk = this.tagKey(tag);
      const members = await this.redis.smembers(tk);
      if (members.length) purged += await this.redis.del(...members);
      await this.redis.del(tk);
    }
    return purged;
  }

  async purgeMark(): Promise<number> {
    return Number((await this.redis.get(this.seqKey())) ?? 0);
  }
}

/** Cache em memória (testes e desenvolvimento sem Valkey). */
export class MemoryResponseCache implements ResponseCache {
  private readonly entries = new Map<string, { value: CachedResponse; expiresAt: number }>();
  private seq = 0;
  private readonly purgedAt = new Map<string, number>();

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

  async set(key: string, value: CachedResponse, ttlSec: number, since?: number): Promise<boolean> {
    if (ttlSec <= 0) return false;
    if (since != null && value.tags.some((t) => (this.purgedAt.get(t) ?? 0) > since)) return false;
    if (this.entries.size > 5_000) this.entries.clear();
    this.entries.set(key, { value, expiresAt: this.now() + ttlSec * 1000 });
    return true;
  }

  async purgeTags(tags: string[]): Promise<number> {
    const wanted = new Set(tags);
    if (!wanted.size) return 0;
    this.seq += 1;
    // a marca só precisa durar um load (memória: só dev e testes, então o teto simples basta)
    if (this.purgedAt.size > 5_000) this.purgedAt.clear();
    for (const t of wanted) this.purgedAt.set(t, this.seq);
    let purged = 0;
    for (const [k, e] of this.entries) {
      if (e.value.tags.some((t) => wanted.has(t))) {
        this.entries.delete(k);
        purged += 1;
      }
    }
    return purged;
  }

  async purgeMark(): Promise<number> {
    return this.seq;
  }
}
