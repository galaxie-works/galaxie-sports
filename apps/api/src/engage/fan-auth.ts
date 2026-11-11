/**
 * Autenticação das rotas do torcedor (`config.fan`, #937): token `gft_` em `Authorization: Bearer`. Verificar
 * não consulta o banco. A exclusão do Perfil grava uma marca no Valkey que derruba os tokens dele na hora,
 * antes do prazo; com o Valkey fora, as rotas que leem o Perfil no banco continuam recusando o Perfil excluído.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { readRuntimeOverrides, type Database } from '@galaxie/db';
import { resolveSetting, settingDef } from '@galaxie/runtime-config';
import { problems, ProblemError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import { FAN_TOKEN_PREFIX, FAN_TOKEN_TTL_S, type FanTokenSigner } from './fan-token.js';

/** Perfis excluídos: os tokens já emitidos para eles param de valer. */
export interface FanRevocations {
  revoke(tenantId: string, profileId: string, ttlSeconds: number): Promise<void>;
  isRevoked(tenantId: string, profileId: string): Promise<boolean>;
}

export class RedisFanRevocations implements FanRevocations {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}
  private key(tenantId: string, profileId: string) {
    return `${this.prefix}fan:revoked:${tenantId}:${profileId}`;
  }
  async revoke(tenantId: string, profileId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(tenantId, profileId), '1', 'EX', ttlSeconds);
  }
  async isRevoked(tenantId: string, profileId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(tenantId, profileId))) === 1;
  }
}

export class MemoryFanRevocations implements FanRevocations {
  private readonly until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async revoke(tenantId: string, profileId: string, ttlSeconds: number): Promise<void> {
    if (this.until.size > 100_000) this.until.clear();
    this.until.set(`${tenantId}:${profileId}`, this.now() + ttlSeconds * 1000);
  }
  async isRevoked(tenantId: string, profileId: string): Promise<boolean> {
    const t = this.until.get(`${tenantId}:${profileId}`);
    return t !== undefined && t > this.now();
  }
}

/** FAN_TOKEN_TTL_SECONDS (painel > env > 900), relido no máximo a cada minuto. */
export class FanTokenTtl {
  private value = FAN_TOKEN_TTL_S;
  private readAt = 0;
  constructor(
    private readonly db: Database | undefined,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => number = Date.now,
  ) {}

  async seconds(): Promise<number> {
    if (this.now() - this.readAt < 60_000) return this.value;
    this.readAt = this.now();
    try {
      const def = settingDef('FAN_TOKEN_TTL_SECONDS')!;
      const overrides = this.db ? await readRuntimeOverrides(this.db) : new Map<string, string>();
      const raw = resolveSetting(def, { overrides, env: (k) => this.env[k] }).value;
      const n = Number(raw);
      if (Number.isInteger(n) && n >= (def.min ?? 60) && n <= (def.max ?? 3600)) this.value = n;
    } catch {
      // painel indisponível: segue com o último valor lido
    }
    return this.value;
  }
}

/** Teto da exclusão: a marca dura o maior prazo que um token pode ter. */
export const FAN_REVOCATION_TTL_S = 3600;

const FAN_RATE_LIMIT_PER_MINUTE = 120;

function bearer(request: FastifyRequest): string | undefined {
  const h = request.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const [scheme, token] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token?.startsWith(FAN_TOKEN_PREFIX) ? token : undefined;
}

export interface FanAuthDeps {
  signer: FanTokenSigner | null;
  revocations: FanRevocations;
  limiter: RateLimiter;
  windowMs: number;
}

/** Hook das rotas com `config.fan`: token válido, Perfil não excluído e limite por Perfil. */
export function registerFanAuth(app: FastifyInstance, deps: FanAuthDeps): void {
  app.decorateRequest('fan', null);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.routeOptions.config?.fan) return;
    reply.header('cache-control', 'no-store');
    const token = bearer(request);
    if (!token) throw problems.invalidFanToken();
    if (!deps.signer) throw problems.degraded('Tokens do torcedor não configurados (FAN_TOKEN_SECRET).');
    const claims = deps.signer.verify(token);
    if (!claims) throw problems.invalidFanToken();
    try {
      if (await deps.revocations.isRevoked(claims.tenantId, claims.profileId))
        throw problems.invalidFanToken('Perfil excluído.');
    } catch (err) {
      if (err instanceof ProblemError) throw err;
      request.log.warn({ err }, 'marca de exclusão do torcedor indisponível');
    }
    try {
      const r = await deps.limiter.hit(
        `fan:${claims.tenantId}:${claims.profileId}`,
        FAN_RATE_LIMIT_PER_MINUTE,
        deps.windowMs,
      );
      if (!r.allowed) throw problems.rateLimited(Math.ceil(r.resetMs / 1000));
    } catch (err) {
      if (err instanceof ProblemError) throw err;
      request.log.warn({ err }, 'rate limit do torcedor indisponível');
    }
    request.fan = claims;
  });
}
