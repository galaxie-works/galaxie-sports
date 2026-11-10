import { randomBytes } from 'node:crypto';
import {
  closeDb,
  createDb,
  ledger,
  reservation,
  runMigrations,
  tenant,
  wallet,
  type Database,
} from '@galaxie/db';
import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEntry,
  ensureWallet,
  getWallet,
  isCosmosError,
  listLedger,
  release,
  releaseExpired,
  reserve,
  setWalletMultiplier,
  setWalletStatus,
  settle,
  upsertFunctionDef,
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

async function newTenant(): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'enterprise', modules: ['core_data'] })
    .returning({ id: tenant.id });
  return row!.id;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => isCosmosError(e) && e.code === code);
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 12 });
  await upsertFunctionDef(db, { name: 'moderation.batch', minCredits: 1, permission: 'cosmos.moderation' });
  await upsertFunctionDef(db, { name: 'assistant.ask', minCredits: 2, permission: 'cosmos.assistant' });
});

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('carteira da Cosmos', () => {
  it('N reservas ao mesmo tempo nunca deixam o saldo negativo', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', credits: 10 });
    // 40 reservas de 1 crédito contra 10 de saldo, todas ao mesmo tempo
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () =>
        reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(10);
    for (const r of refused)
      expect(isCosmosError((r as PromiseRejectedResult).reason, 'insufficient_credits')).toBe(true);
    const w = await getWallet(db, t);
    expect(w).toMatchObject({ available: 0, reserved: 10 });
  });

  it('acertos e devoluções simultâneos fecham a conta: livre + reservado + cobrado = recebido', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', credits: 50 });
    const reservations = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserve(db, { tenantId: t, functionName: 'moderation.batch', estimatedCredits: 2 }, { settings }),
      ),
    );
    await Promise.all(
      reservations.map((r, i) =>
        i % 2 === 0
          ? settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.015 }, { settings })
          : release(db, { tenantId: t, reservationId: r.id }),
      ),
    );
    const w = await getWallet(db, t);
    // 10 acertos de 1,5 crédito (0,015 ÷ 0,01, acima do mínimo 1); 10 devoluções
    expect(w).toMatchObject({ available: 35, reserved: 0, receivedTotal: 50 });
    const { entries } = await listLedger(db, t, { kinds: ['usage'] });
    expect(entries).toHaveLength(10);
    expect(entries.every((e) => e.credits === -1.5)).toBe(true);
  });

  it('settle devolve a sobra, cobra a diferença até o saldo e registra antes e depois', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', credits: 5 });
    const r1 = await reserve(
      db,
      { tenantId: t, functionName: 'assistant.ask', estimatedCredits: 4 },
      { settings },
    );
    // custo real 0,025 → 2,5 créditos: devolve 1,5 da reserva
    const s1 = await settle(
      db,
      { tenantId: t, reservationId: r1.id, costUsd: 0.025, tokensIn: 900, model: 'm' },
      { settings },
    );
    expect(s1).toMatchObject({ charged: 2.5, uncharged: 0, available: 2.5 });

    const r2 = await reserve(db, { tenantId: t, functionName: 'assistant.ask' }, { settings });
    // custo real bem acima do que sobra: cobra só até o saldo, o resto fica registrado
    const s2 = await settle(db, { tenantId: t, reservationId: r2.id, costUsd: 0.1 }, { settings });
    expect(s2).toMatchObject({ charged: 2.5, uncharged: 7.5, available: 0 });

    const rows = await db.select().from(ledger).where(eq(ledger.tenantId, t)).orderBy(asc(ledger.id));
    expect(rows.map((r) => [r.kind, r.credits, r.balanceBefore, r.balanceAfter])).toEqual([
      ['purchase', 5, 0, 5],
      ['usage', -2.5, 5, 2.5],
      ['usage', -2.5, 2.5, 0],
    ]);
    expect(rows[2]!.metadata).toMatchObject({ uncharged: 7.5 });
    await expectCode(
      settle(db, { tenantId: t, reservationId: r2.id, costUsd: 0.01 }, { settings }),
      'reservation_closed',
    );
  });

  it('multiplicador do tenant entra na conversão', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', credits: 20 });
    await setWalletMultiplier(db, t, 2);
    const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings });
    const s = await settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.03 }, { settings });
    expect(s.charged).toBe(6);
  });

  it('recusa sem carteira, bloqueada, função desconhecida e outro tenant', async () => {
    const t = await newTenant();
    await expectCode(
      reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings }),
      'no_wallet',
    );
    await ensureWallet(db, t);
    await expectCode(
      reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings }),
      'insufficient_credits',
    );
    await addEntry(db, { tenantId: t, kind: 'adjustment', credits: 3, note: 'cortesia' });
    await setWalletStatus(db, t, 'blocked');
    await expectCode(
      reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings }),
      'wallet_blocked',
    );
    await setWalletStatus(db, t, 'active');
    await expectCode(
      reserve(db, { tenantId: t, functionName: 'nao.existe' }, { settings }),
      'unknown_function',
    );

    const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings });
    const other = await newTenant();
    await expectCode(release(db, { tenantId: other, reservationId: r.id }), 'reservation_closed');
    await expectCode(addEntry(db, { tenantId: t, kind: 'adjustment', credits: -10 }), 'insufficient_credits');
  });

  it('teto de segurança do dia: soma o custo real de todos os tenants e recusa ao alcançar', async () => {
    const day = new Date('2030-01-02T12:00:00Z');
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', credits: 100 });
    const capped: CosmosSettings = { dailyUsdCeiling: 0.05, creditUsd: 0.01 };
    const r = await reserve(
      db,
      { tenantId: t, functionName: 'moderation.batch' },
      { settings: capped, now: day },
    );
    await settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.05 }, { settings: capped, now: day });
    await expectCode(
      reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings: capped, now: day }),
      'safety_ceiling',
    );
    // no dia seguinte (UTC) volta
    const next = new Date('2030-01-03T00:00:01Z');
    await expect(
      reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings: capped, now: next }),
    ).resolves.toBeDefined();
  });

  it('teste marca a carteira; reservas vencidas voltam ao saldo', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'trial', credits: 4 });
    expect(await getWallet(db, t)).toMatchObject({ trialGranted: true, available: 4, receivedTotal: 4 });
    const past = new Date(Date.now() - 3_600_000);
    const r = await reserve(
      db,
      { tenantId: t, functionName: 'moderation.batch', ttlSeconds: 60 },
      { settings, now: past },
    );
    expect((await getWallet(db, t))?.available).toBe(3);
    expect(await releaseExpired(db)).toBeGreaterThanOrEqual(1);
    expect(await getWallet(db, t)).toMatchObject({ available: 4, reserved: 0 });
    const [row] = await db.select().from(reservation).where(eq(reservation.id, r.id));
    expect(row?.status).toBe('expired');
  });

  it('extrato paginado e filtrável por função e sala', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', credits: 30 });
    for (const scope of ['chat:a', 'chat:a', 'chat:b']) {
      const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch', scope }, { settings });
      await settle(db, { tenantId: t, reservationId: r.id }, { settings });
    }
    const page1 = await listLedger(db, t, { limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listLedger(db, t, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.entries.map((e) => e.kind)).toEqual(['usage', 'purchase']);
    expect(page2.nextCursor).toBeNull();
    expect((await listLedger(db, t, { scope: 'chat:a' })).entries).toHaveLength(2);
    expect((await listLedger(db, t, { functionName: 'assistant.ask' })).entries).toHaveLength(0);
  });

  it('teste concedido uma vez só, mesmo com repetição e concorrência', async () => {
    const t = await newTenant();
    const grants = await Promise.allSettled(
      Array.from({ length: 8 }, () => addEntry(db, { tenantId: t, kind: 'trial', credits: 250 })),
    );
    expect(grants.filter((g) => g.status === 'fulfilled')).toHaveLength(1);
    for (const g of grants.filter((g) => g.status === 'rejected'))
      expect(isCosmosError((g as PromiseRejectedResult).reason, 'trial_already_granted')).toBe(true);
    // repetição depois (desligou e religou): continua recusada
    await expectCode(addEntry(db, { tenantId: t, kind: 'trial', credits: 250 }), 'trial_already_granted');
    expect(await getWallet(db, t)).toMatchObject({ available: 250, receivedTotal: 250, trialGranted: true });
    const { entries } = await listLedger(db, t, { kinds: ['trial'] });
    expect(entries).toHaveLength(1);
  });

  it('teste de 0 (ou que arredonda para 0) é recusado e não queima o teste', async () => {
    const t = await newTenant();
    for (const credits of [0, 0.0004, -5])
      await expectCode(addEntry(db, { tenantId: t, kind: 'trial', credits }), 'invalid_amount');
    await expectCode(addEntry(db, { tenantId: t, kind: 'purchase', credits: -1 }), 'invalid_amount');
    expect(await getWallet(db, t)).toBeNull();
    await expect(addEntry(db, { tenantId: t, kind: 'trial', credits: 250 })).resolves.toMatchObject({
      available: 250,
    });
  });

  it('custo real inválido não acerta a reserva nem entra no teto', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', credits: 10 });
    const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings });
    for (const costUsd of [Number.NaN, Number.POSITIVE_INFINITY, -0.01])
      await expectCode(
        settle(db, { tenantId: t, reservationId: r.id, costUsd }, { settings }),
        'invalid_amount',
      );
    // a reserva continua aberta e pode ser acertada com o valor certo
    await expect(
      settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.01 }, { settings }),
    ).resolves.toMatchObject({
      charged: 1,
    });
    const { entries } = await listLedger(db, t, { kinds: ['usage'] });
    expect(entries.map((e) => e.costUsd)).toEqual([0.01]);
  });

  it('o banco recusa saldo negativo mesmo por fora da biblioteca', async () => {
    const t = await newTenant();
    await ensureWallet(db, t);
    await expect(db.update(wallet).set({ available: -1 }).where(eq(wallet.tenantId, t))).rejects.toThrow();
  });
});
