import { randomBytes } from 'node:crypto';
import { ledger, tenant, type Database } from '@galaxie/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEntry,
  approveWithQuota,
  createCreditRequest,
  listCreditRequests,
  ensureWallet,
  isCosmosError,
  raiseQuota,
  readQuotaOverview,
  release,
  reserve,
  setQuotas,
  upsertFunctionDef,
  type CosmosSettings,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;
const settings: CosmosSettings = { dailyUsdCeiling: null, creditUsd: 0.01 };

async function newTenant(credits: number): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'enterprise', modules: ['core_data'] })
    .returning({ id: tenant.id });
  await ensureWallet(db, row!.id);
  await addEntry(db, {
    tenantId: row!.id,
    kind: 'purchase',
    credits,
    idempotencyKey: `k-${randomBytes(6).toString('hex')}`,
  });
  return row!.id;
}

const ask = (tenantId: string, scope: string, credits: number) =>
  reserve(db, { tenantId, functionName: 'moderation.batch', estimatedCredits: credits, scope }, { settings });

beforeAll(async () => {
  temp = await createTempDb({ max: 8 });
  db = temp.db;
  await upsertFunctionDef(db, { name: 'moderation.batch', minCredits: 1, permission: 'cosmos.moderation' });
});

afterAll(async () => {
  await temp?.close();
});

describe('cota da carteira por sala (#1116)', () => {
  it('reservas simultâneas nunca passam da cota da sala', async () => {
    const t = await newTenant(1000);
    await setQuotas(db, { tenantId: t, quotas: [{ scope: 'chat', percent: 10 }], userId: 'u1' });
    // 30 pedidos de 10 créditos ao mesmo tempo numa cota de 100
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => ask(t, 'chat:r1', 10)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter(
      (r) => r.status === 'rejected' && isCosmosError(r.reason) && r.reason.code === 'quota_exceeded',
    );
    expect(ok).toHaveLength(10);
    expect(refused).toHaveLength(20);
    const view = await readQuotaOverview(db, t);
    expect(view.quotas[0]).toMatchObject({ scope: 'chat', credits: 100, used: 100, remaining: 0 });
    expect(view.unassignedPercent).toBe(90);
    // fora do chat, só o saldo da carteira vale
    await expect(ask(t, 'pool', 50)).resolves.toBeTruthy();
  });

  it('a cota da sala vale antes da do produto, e liberar devolve espaço na cota', async () => {
    const t = await newTenant(1000);
    await setQuotas(db, {
      tenantId: t,
      quotas: [
        { scope: 'community', percent: 50 },
        { scope: 'community:c1', percent: 2 },
      ],
      userId: 'u1',
    });
    const first = await ask(t, 'community:c1', 20);
    await expect(ask(t, 'community:c1', 1)).rejects.toSatisfy(
      (e: unknown) => isCosmosError(e) && e.code === 'quota_exceeded',
    );
    // outra comunidade usa a cota do produto, que não conta a c1
    await expect(ask(t, 'community:c2', 200)).resolves.toBeTruthy();
    await release(db, { tenantId: t, reservationId: first.id });
    await expect(ask(t, 'community:c1', 20)).resolves.toBeTruthy();
  });

  it('mudar as cotas grava quota_change no extrato; aprovar pode aumentar a cota', async () => {
    const t = await newTenant(1000);
    await setQuotas(db, { tenantId: t, quotas: [{ scope: 'pool', percent: 1 }], userId: 'u1' });
    await expect(ask(t, 'pool', 20)).rejects.toSatisfy(
      (e: unknown) => isCosmosError(e) && e.code === 'quota_exceeded',
    );
    await raiseQuota(db, { tenantId: t, scope: 'pool', addPercent: 2, userId: 'u1' });
    await expect(ask(t, 'pool', 20)).resolves.toBeTruthy();
    const changes = await db
      .select({ credits: ledger.credits, metadata: ledger.metadata })
      .from(ledger)
      .where(and(eq(ledger.tenantId, t), eq(ledger.kind, 'quota_change')));
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => Number(c.credits) === 0)).toBe(true);
    await expect(
      setQuotas(db, { tenantId: t, quotas: [{ scope: 'pool', percent: 120 }], userId: 'u1' }),
    ).rejects.toSatisfy((e: unknown) => isCosmosError(e) && e.code === 'invalid_quota');
  });

  it('aprovar com cota é atômico: se a cota não sobe, o pedido continua aberto', async () => {
    const t = await newTenant(1000);
    await setQuotas(db, {
      tenantId: t,
      quotas: Array.from({ length: 50 }, (_, i) => ({ scope: `chat:r${i}`, percent: 1 })),
      userId: 'u1',
    });
    const req = await createCreditRequest(db, { tenantId: t, userId: 'u2', reason: 'Clássico no domingo' });
    await expect(
      approveWithQuota(db, {
        tenantId: t,
        requestId: req.id,
        userId: 'u1',
        scope: 'chat:nova',
        addPercent: 5,
      }),
    ).rejects.toSatisfy((e: unknown) => isCosmosError(e) && e.code === 'invalid_quota');
    const [still] = await listCreditRequests(db, t);
    expect(still?.status).toBe('open');
    // sala com cota: aprova e aumenta junto
    const done = await approveWithQuota(db, {
      tenantId: t,
      requestId: req.id,
      userId: 'u1',
      scope: 'chat:r1',
      addPercent: 4,
    });
    expect(done.request.status).toBe('approved');
    expect(done.quotas.find((q) => q.scope === 'chat:r1')?.percent).toBe(5);
  });

  it('sem cota que valha, a reserva com escopo não confere nada', async () => {
    const t = await newTenant(100);
    await setQuotas(db, { tenantId: t, quotas: [{ scope: 'pool', percent: 1 }], userId: 'u1' });
    await expect(ask(t, 'chat:r1', 90)).resolves.toBeTruthy();
    await expect(ask(t, 'assistant', 5)).resolves.toBeTruthy();
  });
});
