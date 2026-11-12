import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { Database } from '@galaxie/db';
import {
  entitlements,
  loadCatalog,
  recordCatalogVersion,
  type Catalog,
  type Entitlements,
  type EntitlementsCacheStore,
} from '@galaxie/billing';

type Resolver = (tenantId: string) => Promise<Pick<Entitlements, 'modules' | 'features'> | null>;

/** Cache dos direitos no Valkey, com o prefixo do ambiente (o mesmo das outras chaves da API). */
export function redisEntitlementsCache(redis: Redis, prefix: string): EntitlementsCacheStore {
  return {
    get: (k) => redis.get(prefix + k),
    set: (k, v, mode, seconds) => redis.set(prefix + k, v, mode, seconds),
    del: (k) => redis.del(prefix + k),
  };
}

/**
 * Quem resolve os direitos na API (plataforma comercial, #1137): a opção do servidor, ou o padrão com o catálogo de
 * `config/catalog` e o banco. Sem banco, ou com `entitlements: false`, não há resolução (módulos das colunas do
 * tenant). Na subida, grava a versão do catálogo em `billing.catalog_version` (sem derrubar a API se falhar).
 */
export function entitlementsResolver(
  options: { db?: Database; redis?: Redis; entitlements?: Resolver | false; catalog?: Catalog },
  prefix: string,
  log: FastifyBaseLogger,
): Resolver | undefined {
  if (options.entitlements === false) return undefined;
  if (options.entitlements) return options.entitlements;
  if (!options.db) return undefined;
  const db = options.db;
  const catalog = options.catalog ?? loadCatalog();
  recordCatalogVersion(db, catalog.version).catch((err) =>
    log.warn({ err, version: catalog.version }, 'não foi possível gravar a versão do catálogo'),
  );
  const cache = options.redis ? redisEntitlementsCache(options.redis, prefix) : null;
  // memória do processo por alguns segundos: uma rajada do mesmo tenant não vira uma ida ao Valkey (ou ao banco) por
  // requisição. A invalidação vale em até MEMO_MS nesta instância
  const memo = new Map<
    string,
    { at: number; value: Promise<Pick<Entitlements, 'modules' | 'features'> | null> }
  >();
  return (tenantId) => {
    const now = Date.now();
    const hit = memo.get(tenantId);
    if (hit && now - hit.at < MEMO_MS) return hit.value;
    if (memo.size >= 10_000) memo.clear();
    const value = entitlements({ db, catalog, cache }, tenantId);
    memo.set(tenantId, { at: now, value });
    // falha não fica guardada: a próxima requisição tenta de novo
    value.catch(() => memo.delete(tenantId));
    return value;
  };
}

/** Quanto tempo os direitos ficam na memória do processo (ms). */
export const MEMO_MS = 5_000;
