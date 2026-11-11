import { randomBytes, randomUUID } from 'node:crypto';
import { autoRecharge, purchaseIntent, rechargeAttempt, tenant, type Database } from '@galaxie/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEntry,
  configureAutoRecharge,
  getWallet,
  isCosmosError,
  ledgerCsv,
  listAllPackages,
  listLedger,
  listStaffActions,
  reserve,
  settle,
  staffCredit,
  staffSavePackage,
  staffSetBlocked,
  staffSetMultiplier,
  toClientEntry,
  upsertFunctionDef,
  upsertPackage,
  walletsOverview,
  type CosmosSettings,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
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
  temp = await createTempDb();
  db = temp.db;
  await upsertFunctionDef(db, { name: 'fn', minCredits: 1, permission: 'cosmos.test' });
});

afterAll(async () => {
  await temp?.close();
});

describe('carteiras para a equipe Galaxie', () => {
  it('visão de todos os tenants: saldo, consumo, custo real, receita e última compra', async () => {
    const a = await newTenant('Alfa');
    const b = await newTenant('Beta');
    await addEntry(db, { tenantId: a, kind: 'purchase', idempotencyKey: key(), credits: 100 });
    await addEntry(db, {
      tenantId: b,
      kind: 'trial',
      credits: 10,
      trialExpiresAt: new Date(Date.now() + 90 * 86_400_000),
    });
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
    // recarga automática concluída também é receita e compra; a de fora do período só conta na última compra
    const rechargedAt = new Date(Date.now() + 60_000);
    await db.insert(rechargeAttempt).values([
      {
        tenantId: a,
        credits: 500,
        amountCents: 1000,
        currency: 'usd',
        status: 'succeeded',
        updatedAt: rechargedAt,
      },
      {
        tenantId: a,
        credits: 500,
        amountCents: 700,
        currency: 'usd',
        status: 'succeeded',
        updatedAt: new Date(Date.now() - 60 * 86_400_000),
      },
      // falhou: não é receita
      { tenantId: a, credits: 500, amountCents: 300, currency: 'brl', status: 'failed' },
    ]);
    const rows = await walletsOverview(db);
    const alfa = rows.find((x) => x.tenantId === a)!;
    expect(alfa).toMatchObject({
      name: 'Alfa',
      available: 95,
      usedCredits: 5,
      costUsd: 0.05,
      revenueCents: { brl: 4900, usd: 1000 },
    });
    expect(alfa.lastPurchaseAt?.getTime()).toBe(rechargedAt.getTime());
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
      requestKey: randomUUID(),
    });
    await staffCredit(db, {
      tenantId: t,
      kind: 'refund',
      credits: 3,
      reason: 'falha na moderação',
      userId: 'adm1',
      requestKey: randomUUID(),
    });
    await staffCredit(db, {
      tenantId: t,
      kind: 'adjustment',
      credits: -2,
      reason: 'correção manual',
      userId: 'adm2',
      requestKey: randomUUID(),
    });
    await expectCode(
      staffCredit(db, {
        tenantId: t,
        kind: 'adjustment',
        credits: 1,
        reason: ' ',
        userId: 'a',
        requestKey: randomUUID(),
      }),
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

  it('ajuste com a mesma chave da janela não lança duas vezes; chave inválida é recusada', async () => {
    const t = await newTenant('Zeta');
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
    const requestKey = randomUUID();
    const input = {
      tenantId: t,
      kind: 'adjustment' as const,
      credits: 4,
      reason: 'cortesia do piloto',
      userId: 'adm',
      requestKey,
    };
    const [first, again] = await Promise.all([staffCredit(db, input), staffCredit(db, input)]);
    expect([first.replayed, again.replayed].sort()).toEqual([false, true]);
    expect(again.ledgerId).toBe(first.ledgerId);
    expect((await staffCredit(db, input)).replayed).toBe(true);
    expect((await getWallet(db, t))?.available).toBe(14);
    // outra abertura da janela, outra chave: outro ajuste
    await staffCredit(db, { ...input, requestKey: randomUUID() });
    expect((await getWallet(db, t))?.available).toBe(18);
    await expectCode(staffCredit(db, { ...input, requestKey: 'staff-1' }), 'missing_idempotency_key');
  });

  it('o cliente vê o lançamento da equipe só como Galaxie, sem a pessoa nem o motivo', async () => {
    const t = await newTenant('Eta');
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
    await staffCredit(db, {
      tenantId: t,
      kind: 'adjustment',
      credits: 2,
      reason: 'motivo interno da equipe',
      userId: 'adm-interno',
      requestKey: randomUUID(),
    });
    const { entries } = await listLedger(db, t);
    expect(entries.map((e) => [e.kind, e.staff])).toEqual([
      ['adjustment', true],
      ['purchase', false],
    ]);
    expect(toClientEntry(entries[0]!)).toMatchObject({ staff: true, userId: null, note: null });
    const csv = ledgerCsv(entries);
    expect(csv).not.toContain('adm-interno');
    expect(csv).not.toContain('motivo interno');
    expect(csv).toContain(',Galaxie,');
    // a equipe segue vendo quem fez e o motivo
    expect(ledgerCsv(entries, { staff: true })).toContain('motivo interno da equipe');
  });

  it('bloqueio da equipe impede a recarga automática, inclusive depois de um ajuste negativo', async () => {
    const pkg = await upsertPackage(db, {
      name: 'Teste',
      credits: 500,
      priceCents: 1000,
      currency: 'brl',
      market: 'BR',
    });
    const t = await newTenant('Teta');
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 30 });
    await configureAutoRecharge(db, {
      tenantId: t,
      enabled: true,
      packageId: pkg,
      thresholdCredits: 20,
      accepted: true,
      userId: 'dono',
    });
    await db.update(autoRecharge).set({ stripeCustomerId: 'cus_staff' }).where(eq(autoRecharge.tenantId, t));
    const attempts = async () =>
      (await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, t))).map((a) => a.status);

    // ajuste negativo abaixo do limiar, sem bloqueio: abre a tentativa; o bloqueio a encerra
    await staffCredit(db, {
      tenantId: t,
      kind: 'adjustment',
      credits: -15,
      reason: 'correção manual',
      userId: 'adm',
      requestKey: randomUUID(),
    });
    expect(await attempts()).toEqual(['pending']);
    await staffSetBlocked(db, { tenantId: t, blocked: true, reason: 'pagamento em atraso', userId: 'adm' });
    expect(await attempts()).toEqual(['cancelled']);

    // bloqueada, outro ajuste negativo não abre tentativa
    await staffCredit(db, {
      tenantId: t,
      kind: 'adjustment',
      credits: -5,
      reason: 'correção manual',
      userId: 'adm',
      requestKey: randomUUID(),
    });
    expect(await attempts()).toEqual(['cancelled']);
    expect(await getWallet(db, t)).toMatchObject({ status: 'blocked', blockReason: 'staff', available: 10 });
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
    await addEntry(db, {
      tenantId: t,
      kind: 'trial',
      credits: 1,
      trialExpiresAt: new Date(Date.now() + 90 * 86_400_000),
    });
    await staffCredit(db, {
      tenantId: t,
      kind: 'adjustment',
      credits: -1,
      reason: 'teste encerrado',
      userId: 'a',
      requestKey: randomUUID(),
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
    // o registro falhou (sem quem fez): o preço não muda sem auditoria
    await expect(
      staffSavePackage(db, {
        id,
        name: 'Teste',
        credits: 1000,
        priceCents: 1,
        currency: 'usd',
        market: 'US',
        reason: 'preço errado',
        userId: null as unknown as string,
      }),
    ).rejects.toThrow();
    expect((await listAllPackages(db)).find((p) => p.id === id)).toMatchObject({ priceCents: 1000 });
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
