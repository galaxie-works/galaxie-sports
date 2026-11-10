import { randomBytes } from 'node:crypto';
import { closeDb, createDb, purchaseIntent, runMigrations, tenant, type Database } from '@galaxie/db';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEntry,
  getWallet,
  isCosmosError,
  listAllPackages,
  listLedger,
  listStaffActions,
  reserve,
  settle,
  staffCredit,
  staffSavePackage,
  staffSetBlocked,
  staffSetMultiplier,
  upsertFunctionDef,
  walletsOverview,
  type CosmosSettings,
} from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;
const settings: CosmosSettings = { dailyUsdCeiling: null, creditUsd: 0.01 };
const key = () => `k-${randomBytes(6).toString('hex')}`;

async function newTenant(name: string): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name, plan: 'enterprise', modules: ['core_data'], markets: ['BR'] })
    .returning({ id: tenant.id });
  return row!.id;
}

const expectCode = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => isCosmosError(e) && e.code === code);

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 4 });
  await upsertFunctionDef(db, { name: 'fn', minCredits: 1, permission: 'cosmos.test' });
});

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('carteiras para a equipe Galaxie', () => {
  it('visão de todos os tenants: saldo, consumo, custo real, receita e última compra', async () => {
    const a = await newTenant('Alfa');
    const b = await newTenant('Beta');
    await addEntry(db, { tenantId: a, kind: 'purchase', idempotencyKey: key(), credits: 100 });
    await addEntry(db, { tenantId: b, kind: 'trial', credits: 10 });
    const r = await reserve(db, { tenantId: a, functionName: 'fn' }, { settings });
    await settle(db, { tenantId: a, reservationId: r.id, costUsd: 0.05 });
    await db.insert(purchaseIntent).values({
      tenantId: a,
      credits: 100,
      amountCents: 4900,
      currency: 'brl',
      status: 'paid',
      paidAt: new Date(),
    });
    const rows = await walletsOverview(db);
    const alfa = rows.find((x) => x.tenantId === a)!;
    expect(alfa).toMatchObject({
      name: 'Alfa',
      available: 95,
      usedCredits: 5,
      costUsd: 0.05,
      revenueCents: { brl: 4900, usd: 0 },
    });
    expect(alfa.lastPurchaseAt).not.toBeNull();
    expect(rows.find((x) => x.tenantId === b)).toMatchObject({
      usedCredits: 0,
      costUsd: 0,
      lastPurchaseAt: null,
    });
  });

  it('ajuste e estorno vão para o extrato com quem e o motivo; sem motivo, recusa', async () => {
    const t = await newTenant('Gama');
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 20 });
    await staffCredit(db, {
      tenantId: t,
      kind: 'adjustment',
      credits: 5,
      reason: 'cortesia do piloto',
      userId: 'adm1',
    });
    await staffCredit(db, {
      tenantId: t,
      kind: 'refund',
      credits: 3,
      reason: 'falha na moderação',
      userId: 'adm1',
    });
    await staffCredit(db, {
      tenantId: t,
      kind: 'adjustment',
      credits: -2,
      reason: 'correção manual',
      userId: 'adm2',
    });
    await expectCode(
      staffCredit(db, { tenantId: t, kind: 'adjustment', credits: 1, reason: ' ', userId: 'a' }),
      'reason_required',
    );
    const { entries } = await listLedger(db, t, { kinds: ['adjustment', 'refund'] });
    expect(entries.map((e) => [e.kind, e.credits, e.userId, e.note])).toEqual([
      ['adjustment', -2, 'adm2', 'correção manual'],
      ['refund', 3, 'adm1', 'falha na moderação'],
      ['adjustment', 5, 'adm1', 'cortesia do piloto'],
    ]);
    expect((await getWallet(db, t))?.available).toBe(26);
  });

  it('multiplicador e bloqueio ficam registrados com o antes e o depois', async () => {
    const t = await newTenant('Delta');
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
    await staffSetMultiplier(db, {
      tenantId: t,
      multiplier: 1.5,
      reason: 'contrato enterprise',
      userId: 'adm',
    });
    await staffSetBlocked(db, { tenantId: t, blocked: true, reason: 'pagamento em atraso', userId: 'adm' });
    expect(await getWallet(db, t)).toMatchObject({
      multiplier: 1.5,
      status: 'blocked',
      blockReason: 'staff',
    });
    await staffSetBlocked(db, {
      tenantId: t,
      blocked: false,
      reason: 'pagamento regularizado',
      userId: 'adm',
    });
    expect(await getWallet(db, t)).toMatchObject({ status: 'active', blockReason: null });
    const actions = await listStaffActions(db, t);
    expect(actions.map((a) => [a.action, a.after])).toEqual([
      ['unblock', { status: 'active', blockReason: null }],
      ['block', { status: 'blocked', blockReason: 'staff' }],
      ['multiplier', { multiplier: 1.5 }],
    ]);
    expect(actions[2]!.before).toEqual({ multiplier: 1 });
    await expectCode(
      staffSetMultiplier(db, { tenantId: t, multiplier: 0, reason: 'zerar tudo', userId: 'a' }),
      'invalid_amount',
    );
  });

  it('desbloquear sem saldo deixa bloqueada por saldo zerado', async () => {
    const t = await newTenant('Épsilon');
    await addEntry(db, { tenantId: t, kind: 'trial', credits: 1 });
    await staffCredit(db, {
      tenantId: t,
      kind: 'adjustment',
      credits: -1,
      reason: 'teste encerrado',
      userId: 'a',
    });
    await staffSetBlocked(db, { tenantId: t, blocked: true, reason: 'revisão do contrato', userId: 'a' });
    await staffSetBlocked(db, { tenantId: t, blocked: false, reason: 'revisão concluída', userId: 'a' });
    expect(await getWallet(db, t)).toMatchObject({ status: 'blocked', blockReason: 'depleted' });
  });

  it('pacotes: cria, muda e desativa, com registro; a lista traz os inativos', async () => {
    const id = await staffSavePackage(db, {
      name: 'Teste',
      credits: 1000,
      priceCents: 1000,
      currency: 'usd',
      market: 'US',
      reason: 'pacote novo dos EUA',
      userId: 'adm',
    });
    await staffSavePackage(db, {
      id,
      name: 'Teste',
      credits: 1000,
      priceCents: 1000,
      currency: 'usd',
      market: 'US',
      active: false,
      reason: 'fim da promoção',
      userId: 'adm',
    });
    const all = await listAllPackages(db);
    expect(all.find((p) => p.id === id)).toMatchObject({ active: false });
    await expectCode(
      staffSavePackage(db, {
        name: 'X',
        credits: 1,
        priceCents: 1,
        currency: 'usd',
        market: 'US',
        reason: '',
        userId: 'a',
      }),
      'reason_required',
    );
  });
});
