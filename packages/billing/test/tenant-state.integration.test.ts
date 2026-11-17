import { changeFeed, tenant, tenantStateEvent, type Database } from '@galaxie/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  entitlements,
  entitlementsCacheKey,
  extendTenantTrial,
  loadCatalog,
  recordTenantCreated,
  TENANT_STATE_CHANGED_TOPIC,
  TenantStateError,
  transitionTenantState,
  type EntitlementsCacheStore,
} from '../src/index.js';
import { createTempDb, type TempDb } from './test-db.js';

/*
 * F3, decisão 2: `transitionTenantState` grava o evento, o estado, o espelho de `status` e o `tenant.state_changed`
 * numa transação; recusa a transição fora do diagrama sem gravar nada; invalida o cache de direitos quando o recebe.
 */

let temp: TempDb;
let db: Database;
const catalog = loadCatalog();

function memoryCache(): EntitlementsCacheStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      data.set(k, v);
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

const row = async (id: string) =>
  (
    await db
      .select({ state: tenant.state, status: tenant.status, stateSince: tenant.stateSince })
      .from(tenant)
      .where(eq(tenant.id, id))
  )[0]!;

const events = (id: string) =>
  db
    .select({ from: tenantStateEvent.fromState, to: tenantStateEvent.toState, cause: tenantStateEvent.cause })
    .from(tenantStateEvent)
    .where(eq(tenantStateEvent.tenantId, id))
    .orderBy(tenantStateEvent.createdAt, tenantStateEvent.id);

describe('transitionTenantState', () => {
  it('draft → trial dentro de uma transação: evento, estado, state_since e tenant.state_changed', async () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const id = await newTenant('estado-a', { state: 'draft', stateSince: now });
    const result = await db.transaction(async (tx) => {
      await recordTenantCreated(tx, id, { cause: 'signup', actor: 'signup:u1', now });
      return transitionTenantState(tx, id, 'trial', { cause: 'signup', actor: 'signup:u1', now });
    });
    expect(result).toMatchObject({ tenantId: id, from: 'draft', to: 'trial', stateSince: now });
    expect(await row(id)).toEqual({ state: 'trial', status: 'active', stateSince: now });
    expect(await events(id)).toEqual([
      { from: null, to: 'draft', cause: 'signup' },
      { from: 'draft', to: 'trial', cause: 'signup' },
    ]);
    const published = await db
      .select({ topic: changeFeed.topic, payload: changeFeed.payload })
      .from(changeFeed)
      .where(sql`${changeFeed.entityType} = 'tenant' and ${changeFeed.entityId} = ${id}`);
    expect(published).toEqual([
      {
        topic: TENANT_STATE_CHANGED_TOPIC,
        payload: expect.objectContaining({ from: 'draft', to: 'trial', cause: 'signup', actor: 'signup:u1' }),
      },
    ]);
  });

  it('suspender espelha status = suspended; reativar volta a active', async () => {
    const id = await newTenant('estado-b', { state: 'active' });
    await transitionTenantState(db, id, 'suspended', {
      cause: 'admin',
      actor: 'galaxie:u2',
      reason: 'teste',
    });
    expect(await row(id)).toMatchObject({ state: 'suspended', status: 'suspended' });
    await transitionTenantState(db, id, 'active', { cause: 'admin', actor: 'galaxie:u2', reason: 'teste' });
    expect(await row(id)).toMatchObject({ state: 'active', status: 'active' });
    await transitionTenantState(db, id, 'cancelled', { cause: 'request', actor: 'galaxie:u2' });
    expect(await row(id)).toMatchObject({ state: 'cancelled', status: 'active' });
  });

  it('transição fora do diagrama lança e não grava nada; tenant inexistente também lança', async () => {
    const id = await newTenant('estado-c', { state: 'active' });
    await expect(
      transitionTenantState(db, id, 'trial', { cause: 'admin', actor: 'galaxie:u3' }),
    ).rejects.toMatchObject({
      name: 'TenantStateError',
      code: 'invalid_transition',
      from: 'active',
      to: 'trial',
    });
    expect(await events(id)).toEqual([]);
    expect((await row(id)).state).toBe('active');
    await expect(
      transitionTenantState(db, '00000000-0000-7000-8000-00000000dead', 'trial', {
        cause: 'admin',
        actor: 'x',
      }),
    ).rejects.toBeInstanceOf(TenantStateError);
  });

  it('invalida o cache de direitos quando o recebe', async () => {
    const id = await newTenant('estado-d', {
      state: 'trial',
      trialEndsAt: new Date(Date.now() + 86_400_000),
    });
    const cache = memoryCache();
    expect((await entitlements({ db, catalog, cache }, id))!.state).toBe('trial');
    expect(cache.data.has(entitlementsCacheKey(catalog.version, id))).toBe(true);
    await transitionTenantState(db, id, 'suspended', {
      cause: 'admin',
      actor: 'galaxie:u4',
      reason: 'teste',
      entitlements: { cache, catalog },
    });
    expect(cache.data.has(entitlementsCacheKey(catalog.version, id))).toBe(false);
    const after = await entitlements({ db, catalog, cache }, id);
    expect(after!.state).toBe('suspended');
    expect(after!.modules).toEqual([]);
  });

  it('entitlements com uma transação aberta é recusado antes de gravar (invalidaria antes do commit)', async () => {
    const id = await newTenant('estado-tx', {
      state: 'trial',
      trialEndsAt: new Date(Date.now() + 86_400_000),
    });
    const cache = memoryCache();
    await expect(
      db.transaction((tx) =>
        transitionTenantState(tx, id, 'suspended', {
          cause: 'admin',
          actor: 'galaxie:u6',
          entitlements: { cache, catalog },
        }),
      ),
    ).rejects.toThrow(/só vale com o banco/);
    expect((await row(id)).state).toBe('trial');
    expect(await events(id)).toEqual([]);
  });

  it('estender o trial muda o prazo com um evento admin sem mudar o estado; fora do trial, recusa', async () => {
    const before = new Date('2026-12-01T00:00:00Z');
    const after = new Date('2026-12-15T00:00:00Z');
    const id = await newTenant('estado-e', { state: 'trial', trialEndsAt: before });
    const r = await extendTenantTrial(db, id, after, { actor: 'galaxie:u5', reason: 'mais duas semanas' });
    expect(r).toMatchObject({ before, after });
    expect(
      (await db.select({ t: tenant.trialEndsAt, s: tenant.state }).from(tenant).where(eq(tenant.id, id)))[0],
    ).toEqual({ t: after, s: 'trial' });
    expect(await events(id)).toEqual([{ from: 'trial', to: 'trial', cause: 'admin' }]);

    const active = await newTenant('estado-f', { state: 'active' });
    await expect(extendTenantTrial(db, active, after, { actor: 'galaxie:u5' })).rejects.toMatchObject({
      code: 'wrong_state',
    });
  });
});
