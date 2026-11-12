import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { Database } from '@galaxie/db';
import {
  entitlements,
  invalidateEntitlements,
  loadCatalog,
  recordCatalogVersion,
  type Catalog,
  type Entitlements,
  type EntitlementsCacheStore,
} from '@galaxie/billing';

type Rights = Pick<Entitlements, 'modules' | 'features'>;
export type ResolveRights = (tenantId: string) => Promise<Rights | null>;

/** Quem resolve os direitos na API e apaga o cache depois de uma mudança do tenant. */
export interface EntitlementsResolver {
  resolve: ResolveRights;
  /** Chamar depois de mudar plano, módulos, status, faixas ou exceções do tenant. */
  invalidate(tenantId: string): Promise<void>;
}

/** Quanto tempo os direitos ficam na memória do processo (ms). */
export const MEMO_MS = 5_000;
/** Teto de espera pela resolução: passou disso, a requisição segue com os módulos das colunas do tenant. */
export const RESOLVE_TIMEOUT_MS = 300;

/**
 * Cache dos direitos no Valkey, com o prefixo do ambiente (o mesmo das outras chaves da API). Quem invalida fora da API
 * (console, demo) precisa usar este mesmo embrulho, senão apaga a chave errada.
 */
export function redisEntitlementsCache(redis: Redis, prefix: string): EntitlementsCacheStore {
  return {
    get: (k) => redis.get(prefix + k),
    set: (k, v, mode, seconds) => redis.set(prefix + k, v, mode, seconds),
    del: (k) => redis.del(prefix + k),
  };
}

class ResolveTimeout extends Error {
  constructor(ms: number) {
    super(`direitos do tenant sem resposta em ${ms} ms`);
    this.name = 'ResolveTimeout';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ResolveTimeout(ms)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Memória curta por tenant em volta de uma resolução: uma rajada do mesmo tenant não vira uma ida ao Valkey (ou ao
 * banco) por requisição, e uma falha (banco fora, demora acima do teto) fica guardada pelo mesmo prazo, para que cada
 * requisição não espere o banco de novo antes de seguir pelo caminho antigo.
 */
export function memoResolver(
  inner: ResolveRights,
  opts: { memoMs?: number; timeoutMs?: number; now?: () => number } = {},
): { resolve: ResolveRights; forget(tenantId: string): void } {
  const memoMs = opts.memoMs ?? MEMO_MS;
  const timeoutMs = opts.timeoutMs ?? RESOLVE_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const memo = new Map<string, { at: number; value: Promise<Rights | null> }>();
  return {
    resolve(tenantId) {
      const t = now();
      const hit = memo.get(tenantId);
      if (hit && t - hit.at < memoMs) return hit.value;
      if (memo.size >= 10_000) memo.clear();
      const value = withTimeout(inner(tenantId), timeoutMs);
      // a falha também fica guardada por memoMs; cada leitor recebe a mesma rejeição e trata
      value.catch(() => {});
      memo.set(tenantId, { at: t, value });
      return value;
    },
    forget(tenantId) {
      memo.delete(tenantId);
    },
  };
}

/**
 * Resolvedor padrão da API (plataforma comercial, #1137): a opção do servidor, ou o catálogo de `config/catalog` com o
 * banco e o Valkey. Sem banco, ou com `entitlements: false`, não há resolução (módulos das colunas do tenant). Na
 * subida, grava a versão do catálogo em `billing.catalog_version` (sem derrubar a API se falhar).
 */
export function entitlementsResolver(
  options: { db?: Database; redis?: Redis; entitlements?: ResolveRights | false; catalog?: Catalog },
  prefix: string,
  log: FastifyBaseLogger,
): EntitlementsResolver | undefined {
  if (options.entitlements === false) return undefined;
  if (options.entitlements) {
    const m = memoResolver(options.entitlements);
    return { resolve: m.resolve, invalidate: async (id) => m.forget(id) };
  }
  if (!options.db) return undefined;
  const db = options.db;
  const catalog = options.catalog ?? loadCatalog();
  recordCatalogVersion(db, catalog.version).catch((err) =>
    log.warn({ err, version: catalog.version }, 'não foi possível gravar a versão do catálogo'),
  );
  const cache = options.redis ? redisEntitlementsCache(options.redis, prefix) : null;
  const m = memoResolver((tenantId) => entitlements({ db, catalog, cache }, tenantId));
  return {
    resolve: m.resolve,
    async invalidate(tenantId) {
      m.forget(tenantId);
      await invalidateEntitlements(cache, catalog, tenantId);
    },
  };
}
