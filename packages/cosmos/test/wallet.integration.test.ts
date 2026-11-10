import { randomBytes } from 'node:crypto';
import {
  closeDb,
  createDb,
  ledger,
  reservation,
  runMigrations,
  tenant,
  wallet,
  writeRuntimeSetting,
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

/** Chave de idempotência nova (cada compra do teste é uma compra diferente). */
const key = () => `k-${randomBytes(6).toString('hex')}`;

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

/** Prazo do teste nos testes: 90 dias à frente. */
const soon = () => new Date(Date.now() + 90 * 86_400_000);

describe('carteira da Cosmos', () => {
  it('N reservas ao mesmo tempo nunca deixam o saldo negativo', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
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
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 50 });
    const reservations = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserve(db, { tenantId: t, functionName: 'moderation.batch', estimatedCredits: 2 }, { settings }),
      ),
    );
    await Promise.all(
      reservations.map((r, i) =>
        i % 2 === 0
          ? settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.015 })
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
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 5 });
    const r1 = await reserve(
      db,
      { tenantId: t, functionName: 'assistant.ask', estimatedCredits: 4 },
      { settings },
    );
    // custo real 0,025 → 2,5 créditos: devolve 1,5 da reserva
    const s1 = await settle(db, {
      tenantId: t,
      reservationId: r1.id,
      costUsd: 0.025,
      tokensIn: 900,
      model: 'm',
    });
    expect(s1).toMatchObject({ charged: 2.5, uncharged: 0, available: 2.5 });

    const r2 = await reserve(db, { tenantId: t, functionName: 'assistant.ask' }, { settings });
    // custo real bem acima do que sobra: cobra só até o saldo, o resto fica registrado
    const s2 = await settle(db, { tenantId: t, reservationId: r2.id, costUsd: 0.1 });
    expect(s2).toMatchObject({ charged: 2.5, uncharged: 7.5, available: 0 });

    const rows = await db.select().from(ledger).where(eq(ledger.tenantId, t)).orderBy(asc(ledger.id));
    expect(rows.map((r) => [r.kind, r.credits, r.balanceBefore, r.balanceAfter])).toEqual([
      ['purchase', 5, 0, 5],
      ['usage', -2.5, 5, 2.5],
      ['usage', -2.5, 2.5, 0],
    ]);
    expect(rows[2]!.metadata).toMatchObject({ uncharged: 7.5 });
    // repetir o acerto devolve o mesmo resultado, sem cobrar de novo
    await expect(settle(db, { tenantId: t, reservationId: r2.id, costUsd: 0.01 })).resolves.toMatchObject({
      charged: 2.5,
      uncharged: 7.5,
      replayed: true,
    });
    expect((await getWallet(db, t))?.available).toBe(0);
  });

  it('multiplicador do tenant entra na conversão', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 20 });
    await setWalletMultiplier(db, t, 2);
    const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings });
    const s = await settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.03 });
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
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 100 });
    const capped: CosmosSettings = { dailyUsdCeiling: 0.05, creditUsd: 0.01 };
    const r = await reserve(
      db,
      { tenantId: t, functionName: 'moderation.batch' },
      { settings: capped, now: day },
    );
    await settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.05 }, { now: day });
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
    await addEntry(db, { tenantId: t, kind: 'trial', credits: 4, trialExpiresAt: soon() });
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
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 30 });
    for (const scope of ['chat:a', 'chat:a', 'chat:b']) {
      const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch', scope }, { settings });
      await settle(db, { tenantId: t, reservationId: r.id });
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
      Array.from({ length: 8 }, () =>
        addEntry(db, { tenantId: t, kind: 'trial', credits: 250, trialExpiresAt: soon() }),
      ),
    );
    expect(grants.filter((g) => g.status === 'fulfilled')).toHaveLength(1);
    for (const g of grants.filter((g) => g.status === 'rejected'))
      expect(isCosmosError((g as PromiseRejectedResult).reason, 'trial_already_granted')).toBe(true);
    // repetição depois (desligou e religou): continua recusada
    await expectCode(
      addEntry(db, { tenantId: t, kind: 'trial', credits: 250, trialExpiresAt: soon() }),
      'trial_already_granted',
    );
    expect(await getWallet(db, t)).toMatchObject({ available: 250, receivedTotal: 250, trialGranted: true });
    const { entries } = await listLedger(db, t, { kinds: ['trial'] });
    expect(entries).toHaveLength(1);
  });

  it('teste de 0 (ou que arredonda para 0) é recusado e não queima o teste', async () => {
    const t = await newTenant();
    for (const credits of [0, 0.0004, -5])
      await expectCode(
        addEntry(db, { tenantId: t, kind: 'trial', credits, trialExpiresAt: soon() }),
        'invalid_amount',
      );
    await expectCode(
      addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: -1 }),
      'invalid_amount',
    );
    expect(await getWallet(db, t)).toBeNull();
    // sem prazo (ou com prazo no passado) nunca venceria: recusado, e o teste não queima
    await expectCode(addEntry(db, { tenantId: t, kind: 'trial', credits: 250 }), 'invalid_amount');
    await expectCode(
      addEntry(db, { tenantId: t, kind: 'trial', credits: 250, trialExpiresAt: new Date(Date.now() - 1000) }),
      'invalid_amount',
    );
    await expect(
      addEntry(db, { tenantId: t, kind: 'trial', credits: 250, trialExpiresAt: soon() }),
    ).resolves.toMatchObject({
      available: 250,
    });
  });

  it('custo real inválido não acerta a reserva nem entra no teto', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
    const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings });
    for (const costUsd of [Number.NaN, Number.POSITIVE_INFINITY, -0.01])
      await expectCode(settle(db, { tenantId: t, reservationId: r.id, costUsd }), 'invalid_amount');
    // a reserva continua aberta e pode ser acertada com o valor certo
    await expect(settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.01 })).resolves.toMatchObject({
      charged: 1,
    });
    const { entries } = await listLedger(db, t, { kinds: ['usage'] });
    expect(entries.map((e) => e.costUsd)).toEqual([0.01]);
  });

  it('o preço fica gravado na reserva: mudar o valor do crédito, o multiplicador ou o mínimo no meio não muda a chamada', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 100 });
    await upsertFunctionDef(db, { name: 'snapshot.fn', minCredits: 1, permission: 'cosmos.test' });
    // reserva lendo as flags do banco (sem `settings`), com o crédito a US$ 0,01
    await writeRuntimeSetting(db, {
      key: 'COSMOS_CREDIT_USD',
      value: '0.01',
      valueType: 'number',
      by: 'teste',
    });
    const r = await reserve(db, { tenantId: t, functionName: 'snapshot.fn' });
    // tudo muda antes do acerto
    await writeRuntimeSetting(db, {
      key: 'COSMOS_CREDIT_USD',
      value: '0.001',
      valueType: 'number',
      by: 'teste',
    });
    await setWalletMultiplier(db, t, 5);
    await upsertFunctionDef(db, { name: 'snapshot.fn', minCredits: 50, permission: 'cosmos.test' });
    // 0,03 ÷ 0,01 × 1 = 3 créditos, como no momento da reserva (não 0,03 ÷ 0,001 × 5 = 150, nem o mínimo 50)
    const s = await settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.03 });
    expect(s.charged).toBe(3);
    await writeRuntimeSetting(db, {
      key: 'COSMOS_CREDIT_USD',
      value: null,
      valueType: 'number',
      by: 'teste',
    });
  });

  it('acerto repetido devolve o mesmo acerto sem cobrar de novo; devolução repetida não devolve duas vezes', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
    const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings });
    const first = await settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.02 });
    const again = await Promise.all([
      settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.02 }),
      settle(db, { tenantId: t, reservationId: r.id, costUsd: 0.5 }),
    ]);
    expect(first).toMatchObject({ charged: 2, available: 8, replayed: false });
    for (const a of again)
      expect(a).toMatchObject({ ledgerId: first.ledgerId, charged: 2, available: 8, replayed: true });
    expect((await getWallet(db, t))?.available).toBe(8);
    await expectCode(release(db, { tenantId: t, reservationId: r.id }), 'reservation_closed');

    const r2 = await reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings });
    const releases = await Promise.all([
      release(db, { tenantId: t, reservationId: r2.id }),
      release(db, { tenantId: t, reservationId: r2.id }),
    ]);
    expect(releases.filter((x) => x.released)).toHaveLength(1);
    expect(await getWallet(db, t)).toMatchObject({ available: 8, reserved: 0 });
    // devolvida: o acerto atrasado é recusado (o saldo dela já voltou)
    await expectCode(settle(db, { tenantId: t, reservationId: r2.id, costUsd: 0.01 }), 'reservation_closed');
    await expectCode(
      reserve(db, { tenantId: t, functionName: 'moderation.batch', ttlSeconds: 0 }, { settings }),
      'invalid_amount',
    );
  });

  it('uncharged é chave reservada: o metadata do chamador não muda o acerto nem a repetição', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
    const r = await reserve(db, { tenantId: t, functionName: 'moderation.batch' }, { settings });
    const input = { tenantId: t, reservationId: r.id, costUsd: 0.02, metadata: { uncharged: 99, lote: 'x' } };
    expect(await settle(db, input)).toMatchObject({ charged: 2, uncharged: 0 });
    const [row] = await db.select().from(ledger).where(eq(ledger.reservationId, r.id));
    expect(row?.metadata).toMatchObject({ uncharged: 0, lote: 'x', reserved: 1 });
    expect(await settle(db, input)).toMatchObject({ charged: 2, uncharged: 0, replayed: true });
  });

  it('reserva aberta depois do prazo ainda acerta; vencida pelo job, não', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
    const past = new Date(Date.now() - 3_600_000);
    const late = await reserve(
      db,
      { tenantId: t, functionName: 'moderation.batch', ttlSeconds: 60 },
      { settings, now: past },
    );
    await expect(settle(db, { tenantId: t, reservationId: late.id })).resolves.toMatchObject({ charged: 1 });
    const stale = await reserve(
      db,
      { tenantId: t, functionName: 'moderation.batch', ttlSeconds: 60 },
      { settings, now: past },
    );
    await releaseExpired(db);
    await expectCode(settle(db, { tenantId: t, reservationId: stale.id }), 'reservation_closed');
    expect(await getWallet(db, t)).toMatchObject({ available: 9, reserved: 0 });
  });

  it('compra com a mesma chave soma uma vez só, mesmo ao mesmo tempo; sem chave é recusada', async () => {
    const t = await newTenant();
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        addEntry(db, { tenantId: t, kind: 'purchase', credits: 40, idempotencyKey: k }),
      ),
    );
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.ledgerId)).size).toBe(1);
    expect(await getWallet(db, t)).toMatchObject({ available: 40, receivedTotal: 40 });
    // repetição depois, já com outro uso no meio: devolve o lançamento original
    await addEntry(db, { tenantId: t, kind: 'adjustment', credits: -5 });
    await expect(
      addEntry(db, { tenantId: t, kind: 'purchase', credits: 40, idempotencyKey: k }),
    ).resolves.toMatchObject({
      ledgerId: results[0]!.ledgerId,
      available: 40,
      replayed: true,
    });
    expect((await getWallet(db, t))?.available).toBe(35);
    expect((await listLedger(db, t, { kinds: ['purchase'] })).entries).toHaveLength(1);
    // a mesma chave em outro tenant é outra compra
    const other = await newTenant();
    await expect(
      addEntry(db, { tenantId: other, kind: 'purchase', credits: 1, idempotencyKey: k }),
    ).resolves.toMatchObject({
      replayed: false,
    });
    await expectCode(addEntry(db, { tenantId: t, kind: 'purchase', credits: 1 }), 'missing_idempotency_key');
    await expectCode(addEntry(db, { tenantId: t, kind: 'refund', credits: 1 }), 'missing_idempotency_key');
  });

  it('o banco recusa saldo negativo mesmo por fora da biblioteca', async () => {
    const t = await newTenant();
    await ensureWallet(db, t);
    await expect(db.update(wallet).set({ available: -1 }).where(eq(wallet.tenantId, t))).rejects.toThrow();
  });
});
