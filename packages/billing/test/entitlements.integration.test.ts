import { catalogVersion, tenant, tenantOverride, type Database } from '@galaxie/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  entitlements,
  entitlementsCacheKey,
  invalidateEntitlements,
  loadCatalog,
  recordCatalogVersion,
  type EntitlementsCacheStore,
} from '../src/index.js';
import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;
const catalog = loadCatalog();

/** Cache em memória com a mesma forma do ioredis. */
function memoryCache(): EntitlementsCacheStore & { data: Map<string, string>; ttl: Map<string, number> } {
  const data = new Map<string, string>();
  const ttl = new Map<string, number>();
  return {
    data,
    ttl,
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v, _mode, seconds) {
      data.set(k, v);
      ttl.set(k, seconds);
      return 'OK';
    },
    async del(k) {
      return data.delete(k) ? 1 : 0;
    },
  };
}

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
});
afterAll(async () => {
  await temp?.close();
});

async function newTenant(slug: string, values: Partial<typeof tenant.$inferInsert> = {}) {
  const [t] = await db
    .insert(tenant)
    .values({
      slug,
      name: slug,
      plan: 'fan_experience',
      modules: ['core_data', 'where_to_watch', 'semantic'],
      ...values,
    })
    .returning({ id: tenant.id });
  return t!.id;
}

describe('entitlements() com o banco', () => {
  it('tenant inexistente: null', async () => {
    expect(await entitlements({ db, catalog }, '00000000-0000-7000-8000-00000000dead')).toBeNull();
  });

  it('lê tenant e exceções ativas; cache por versão do catálogo, invalidado depois da mudança', async () => {
    const id = await newTenant('ent-a');
    const cache = memoryCache();
    const deps = { db, catalog, cache };

    const first = await entitlements(deps, id);
    expect(first!.modules).toEqual(['core_data', 'semantic', 'where_to_watch']);
    expect(cache.data.has(entitlementsCacheKey(catalog.version, id))).toBe(true);

    await db.insert(tenantOverride).values({
      tenantId: id,
      kind: 'module_grant',
      key: 'live_chat',
      reason: 'piloto do chat por acordo',
      grantedBy: 'cli:teste',
      validUntil: new Date(Date.now() + 3_600_000),
    });
    // ainda o cache
    expect((await entitlements(deps, id))!.modules).not.toContain('live_chat');
    await invalidateEntitlements(cache, catalog, id);
    const after = await entitlements(deps, id);
    expect(after!.modules).toContain('live_chat');
    expect(after!.version).not.toBe(first!.version);
    // o cache não passa do vencimento da exceção (1 h) nem do padrão
    expect(cache.ttl.get(entitlementsCacheKey(catalog.version, id))).toBeLessThanOrEqual(60);
  });

  it('o cache não passa do vencimento de uma exceção que vence antes do TTL padrão', async () => {
    const id = await newTenant('ent-ttl');
    await db.insert(tenantOverride).values({
      tenantId: id,
      kind: 'module_grant',
      key: 'odds',
      reason: 'degustação curta',
      grantedBy: 'cli:teste',
      validUntil: new Date(Date.now() + 20_000),
    });
    const cache = memoryCache();
    await entitlements({ db, catalog, cache }, id);
    const ttl = cache.ttl.get(entitlementsCacheKey(catalog.version, id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(20);
  });

  it('exceção revogada ou vencida não entra', async () => {
    const id = await newTenant('ent-b');
    await db.insert(tenantOverride).values([
      {
        tenantId: id,
        kind: 'module_grant',
        key: 'communities',
        reason: 'acordo antigo',
        grantedBy: 'cli:teste',
        validUntil: new Date(Date.now() - 1000),
      },
      {
        tenantId: id,
        kind: 'module_grant',
        key: 'gamification',
        reason: 'acordo revogado',
        grantedBy: 'cli:teste',
        validUntil: new Date(Date.now() + 3_600_000),
        revokedAt: new Date(),
        revokedBy: 'cli:teste',
      },
    ]);
    const e = await entitlements({ db, catalog }, id);
    expect(e!.modules).toEqual(['core_data', 'semantic', 'where_to_watch']);
  });

  it('exceção sem motivo ou com valor no tipo errado é recusada pelo banco', async () => {
    const id = await newTenant('ent-c');
    const base = { tenantId: id, grantedBy: 'cli:teste', validUntil: new Date(Date.now() + 1000) };
    await expect(
      db.insert(tenantOverride).values({ ...base, kind: 'module_grant', key: 'odds', reason: '  ' }),
    ).rejects.toThrow();
    await expect(
      db.insert(tenantOverride).values({ ...base, kind: 'module_grant', key: 'odds', reason: 'x', value: 3 }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(tenantOverride)
        .values({ ...base, kind: 'tier', key: 'live_chat.peak_connections', reason: 'x' }),
    ).rejects.toThrow();
  });

  it('cache fora do ar: responde pelo banco', async () => {
    const id = await newTenant('ent-d', { status: 'suspended' });
    const broken: EntitlementsCacheStore = {
      get: () => Promise.reject(new Error('fora')),
      set: () => Promise.reject(new Error('fora')),
      del: () => Promise.reject(new Error('fora')),
    };
    const e = await entitlements({ db, catalog, cache: broken }, id);
    expect(e!.state).toBe('suspended');
    expect(e!.modules).toEqual([]);
    await expect(invalidateEntitlements(broken, catalog, id)).resolves.toBeUndefined();
  });

  it('versão do catálogo registrada uma vez', async () => {
    await recordCatalogVersion(db, catalog.version);
    await recordCatalogVersion(db, catalog.version);
    const rows = await db.select().from(catalogVersion).where(eq(catalogVersion.version, catalog.version));
    expect(rows).toHaveLength(1);
  });
});
