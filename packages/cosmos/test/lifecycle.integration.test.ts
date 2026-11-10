import { randomBytes } from 'node:crypto';
import {
  autoRecharge,
  balanceAlert,
  closeDb,
  createDb,
  rechargeAttempt,
  runMigrations,
  tenant,
  type Database,
} from '@galaxie/db';
import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addEntry,
  applyStripeEvent,
  configureAutoRecharge,
  disableCosmos,
  enableCosmos,
  expireTrials,
  getAutoRecharge,
  getWallet,
  isCosmosError,
  listLedger,
  listPurchasesInReview,
  MAX_RECHARGE_ATTEMPTS,
  processRecharges,
  readTrialSettings,
  reconcileStuckRecharges,
  release,
  reserve,
  settle,
  upsertFunctionDef,
  upsertPackage,
  type CosmosSettings,
  type StripeEvent,
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
let pkg: string;
const settings: CosmosSettings = { dailyUsdCeiling: null, creditUsd: 0.01 };
const trial = { credits: 100, days: 90 };
const key = () => `k-${randomBytes(6).toString('hex')}`;

async function newTenant(): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'enterprise', modules: ['core_data'] })
    .returning({ id: tenant.id });
  return row!.id;
}

/** Gasta `credits` numa chamada (reserva do mínimo e acerto pelo valor fixo). */
async function spend(t: string, credits: number) {
  const r = await reserve(db, { tenantId: t, functionName: 'fn' }, { settings });
  return settle(db, { tenantId: t, reservationId: r.id, credits });
}

const alerts = async (t: string) =>
  (
    await db.select().from(balanceAlert).where(eq(balanceAlert.tenantId, t)).orderBy(asc(balanceAlert.id))
  ).map((a) => a.level);

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 6 });
  await upsertFunctionDef(db, { name: 'fn', minCredits: 1, permission: 'cosmos.test' });
  // preço de teste, não o da tabela da Galaxie
  pkg = await upsertPackage(db, {
    name: 'Teste',
    credits: 500,
    priceCents: 1000,
    currency: 'usd',
    market: 'US',
  });
});

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('teste ao ligar', () => {
  it('padrão do registro: 250 créditos por 90 dias', async () => {
    expect(await readTrialSettings(db, {})).toEqual({ credits: 250, days: 90 });
  });

  it('concede uma vez só, mesmo desligando e religando ou pedindo ao mesmo tempo', async () => {
    const t = await newTenant();
    const now = new Date('2030-03-01T12:00:00Z');
    const results = await Promise.all(Array.from({ length: 5 }, () => enableCosmos(db, t, { trial, now })));
    expect(results.filter((r) => r.trialGranted)).toHaveLength(1);
    expect((await enableCosmos(db, t, { trial, now })).trialGranted).toBe(false);
    const w = await getWallet(db, t);
    expect(w).toMatchObject({ available: 100, trialRemaining: 100, trialGranted: true });
    expect(w?.trialExpiresAt?.toISOString()).toBe('2030-05-30T12:00:00.000Z');
  });

  it('desligar para as reservas e mantém o saldo; religar não dá outro teste', async () => {
    const t = await newTenant();
    await enableCosmos(db, t, { trial });
    await disableCosmos(db, t);
    await expect(reserve(db, { tenantId: t, functionName: 'fn' }, { settings })).rejects.toSatisfy(
      (e: unknown) => isCosmosError(e, 'cosmos_disabled'),
    );
    expect(await getWallet(db, t)).toMatchObject({ enabled: false, available: 100 });
    const again = await enableCosmos(db, t, { trial });
    expect(again).toMatchObject({ trialGranted: false, wallet: { enabled: true, available: 100 } });
    await expect(reserve(db, { tenantId: t, functionName: 'fn' }, { settings })).resolves.toBeDefined();
  });

  it('o uso gasta o teste primeiro; o que sobra no vencimento sai com lançamento; comprado não vence', async () => {
    const t = await newTenant();
    const start = new Date(Date.now() - 100 * 86_400_000);
    await enableCosmos(db, t, { trial, now: start });
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 50 });
    await spend(t, 30);
    expect((await getWallet(db, t))?.trialRemaining).toBe(70);
    expect(await expireTrials(db)).toBeGreaterThanOrEqual(1);
    expect(await getWallet(db, t)).toMatchObject({ available: 50, trialRemaining: 0 });
    const { entries } = await listLedger(db, t, { kinds: ['trial_expiry'] });
    expect(entries.map((e) => [e.credits, e.balanceBefore, e.balanceAfter])).toEqual([[-70, 120, 50]]);
    // rodar de novo não tira mais nada
    await expireTrials(db);
    expect((await getWallet(db, t))?.available).toBe(50);
  });
});

describe('alertas e saldo zerado', () => {
  it('80%, 90% e zerado uma vez por limiar por ciclo; a compra abre um ciclo novo e libera a carteira', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 100 });
    await spend(t, 79);
    expect(await alerts(t)).toEqual([]);
    await spend(t, 2); // 81% usado
    await spend(t, 1); // ainda 80%: não repete
    expect(await alerts(t)).toEqual([80]);
    await spend(t, 9); // 91%
    expect(await alerts(t)).toEqual([80, 90]);
    await spend(t, 9); // zerou
    expect(await alerts(t)).toEqual([80, 90, 100]);
    expect(await getWallet(db, t)).toMatchObject({
      available: 0,
      status: 'blocked',
      blockReason: 'depleted',
    });
    await expect(reserve(db, { tenantId: t, functionName: 'fn' }, { settings })).rejects.toSatisfy(
      (e: unknown) => isCosmosError(e, 'wallet_blocked'),
    );

    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 10 });
    expect(await getWallet(db, t)).toMatchObject({ status: 'active', cycleBase: 10, alertLevel: 0 });
    await spend(t, 9); // 90% do ciclo novo: alerta de novo
    expect((await alerts(t)).slice(3)).toEqual([90]);
  });
});

describe('recarga automática', () => {
  const okFetch = (calls: string[]) =>
    (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes('/payment_methods'))
        return new Response(JSON.stringify({ data: [{ id: 'pm_1' }] }), { status: 200 });
      return new Response(JSON.stringify({ id: `pi_${calls.length}`, status: 'succeeded' }), { status: 200 });
    }) as typeof fetch;

  const piEvent = (
    type: string,
    attemptId: string,
    paymentIntentId: string,
    extra: object = {},
  ): StripeEvent => ({
    id: `evt_${randomBytes(4).toString('hex')}`,
    type,
    data: {
      object: {
        id: paymentIntentId,
        metadata: { recharge_attempt_id: attemptId },
        amount: 1000,
        amount_received: 1000,
        currency: 'usd',
        ...extra,
      },
    },
  });

  it('ligar exige o aceite da cobrança recorrente', async () => {
    const t = await newTenant();
    await expect(
      configureAutoRecharge(db, {
        tenantId: t,
        enabled: true,
        packageId: pkg,
        thresholdCredits: 20,
        accepted: false,
        userId: 'u',
      }),
    ).rejects.toSatisfy((e: unknown) => isCosmosError(e, 'consent_required'));
    expect(await getAutoRecharge(db, t)).toBeNull();
  });

  it('abaixo do limiar abre uma tentativa só; cobra fora da sessão; credita pelo webhook uma vez', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 100 });
    await configureAutoRecharge(db, {
      tenantId: t,
      enabled: true,
      packageId: pkg,
      thresholdCredits: 20,
      accepted: true,
      userId: 'dono',
    });
    await db.update(autoRecharge).set({ stripeCustomerId: 'cus_1' }).where(eq(autoRecharge.tenantId, t));
    expect(await getAutoRecharge(db, t)).toMatchObject({ enabled: true, hasCard: true, acceptedBy: 'dono' });

    await spend(t, 85); // saldo 15 < 20
    await spend(t, 1); // ainda abaixo: não abre outra
    const open = await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, t));
    expect(open).toHaveLength(1);

    const calls: string[] = [];
    expect(await processRecharges(db, 'sk_test_x', { fetchImpl: okFetch(calls) })).toMatchObject({
      charged: 1,
    });
    const [attempt] = await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, t));
    expect(attempt).toMatchObject({ status: 'processing' });
    // ainda sem crédito: só com o webhook
    expect((await getWallet(db, t))?.available).toBe(14);

    const event = piEvent('payment_intent.succeeded', attempt!.id, attempt!.paymentIntentId!);
    expect((await applyStripeEvent(db, event)).outcome).toBe('credited');
    expect((await applyStripeEvent(db, event)).outcome).toBe('duplicate');
    expect(
      (
        await applyStripeEvent(
          db,
          piEvent('payment_intent.succeeded', attempt!.id, attempt!.paymentIntentId!),
        )
      ).outcome,
    ).toBe('already_closed');
    expect((await getWallet(db, t))?.available).toBe(514);
  });

  it('falha de cobrança: tentativa falha, recarga desliga com o motivo e nada é creditado', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 30 });
    await configureAutoRecharge(db, {
      tenantId: t,
      enabled: true,
      packageId: pkg,
      thresholdCredits: 20,
      accepted: true,
      userId: 'dono',
    });
    await db.update(autoRecharge).set({ stripeCustomerId: 'cus_2' }).where(eq(autoRecharge.tenantId, t));
    await spend(t, 15);
    const declined = (async (url: string | URL | Request) =>
      String(url).includes('/payment_methods')
        ? new Response(JSON.stringify({ data: [{ id: 'pm_1' }] }), { status: 200 })
        : new Response(JSON.stringify({ error: { code: 'card_declined', message: 'recusado' } }), {
            status: 402,
          })) as typeof fetch;
    expect(await processRecharges(db, 'sk_test_x', { fetchImpl: declined })).toMatchObject({ failed: 1 });
    expect(await getAutoRecharge(db, t)).toMatchObject({
      enabled: false,
      lastFailureReason: 'card_declined',
    });
    expect((await getWallet(db, t))?.available).toBe(15);
    // desligada, o próximo uso não abre outra tentativa
    await spend(t, 1);
    const attempts = await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, t));
    expect(attempts.map((a) => a.status)).toEqual(['failed']);
  });

  it('pagamento recusado depois (webhook payment_failed) também desliga e não credita', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 30 });
    await configureAutoRecharge(db, {
      tenantId: t,
      enabled: true,
      packageId: pkg,
      thresholdCredits: 20,
      accepted: true,
      userId: 'dono',
    });
    await db.update(autoRecharge).set({ stripeCustomerId: 'cus_3' }).where(eq(autoRecharge.tenantId, t));
    await spend(t, 15);
    await processRecharges(db, 'sk_test_x', { fetchImpl: okFetch([]) });
    const [attempt] = await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, t));
    const failed = piEvent('payment_intent.payment_failed', attempt!.id, attempt!.paymentIntentId!, {
      last_payment_error: { decline_code: 'insufficient_funds' },
    });
    expect((await applyStripeEvent(db, failed)).outcome).toBe('failed');
    expect(await getAutoRecharge(db, t)).toMatchObject({
      enabled: false,
      lastFailureReason: 'insufficient_funds',
    });
    expect((await getWallet(db, t))?.available).toBe(15);
  });
  /** Tenant com 30 créditos, recarga ligada (limiar 20) e cartão salvo; gasta 15 e abre a tentativa. */
  async function withOpenAttempt(customer: string) {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 30 });
    await configureAutoRecharge(db, {
      tenantId: t,
      enabled: true,
      packageId: pkg,
      thresholdCredits: 20,
      accepted: true,
      userId: 'dono',
    });
    await db.update(autoRecharge).set({ stripeCustomerId: customer }).where(eq(autoRecharge.tenantId, t));
    await spend(t, 15);
    const statuses = async () =>
      (await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, t))).map((a) => a.status);
    return { t, statuses };
  }

  it('desligar a recarga (ou a Cosmos) encerra a tentativa pendente e nada é cobrado', async () => {
    const a = await withOpenAttempt('cus_4');
    await configureAutoRecharge(db, { tenantId: a.t, enabled: false, accepted: false, userId: 'dono' });
    const calls: string[] = [];
    expect(await processRecharges(db, 'sk_test_x', { fetchImpl: okFetch(calls) })).toMatchObject({
      charged: 0,
    });
    expect(calls).toEqual([]);
    expect(await a.statuses()).toEqual(['cancelled']);

    const b = await withOpenAttempt('cus_5');
    await disableCosmos(db, b.t);
    expect(await b.statuses()).toEqual(['cancelled']);
    expect((await getWallet(db, b.t))?.enabled).toBe(false);
  });

  it('aceite retirado direto no banco: o job encerra em vez de cobrar', async () => {
    const a = await withOpenAttempt('cus_6');
    await db.update(autoRecharge).set({ acceptedAt: null }).where(eq(autoRecharge.tenantId, a.t));
    const calls: string[] = [];
    await processRecharges(db, 'sk_test_x', { fetchImpl: okFetch(calls) });
    expect(calls).toEqual([]);
    expect(await a.statuses()).toEqual(['cancelled']);
  });

  it('5xx do Stripe: volta para a fila com o mesmo cartão e a recarga segue ligada', async () => {
    const a = await withOpenAttempt('cus_7');
    const bodies: string[] = [];
    const flaky = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/payment_methods'))
        return new Response(JSON.stringify({ data: [{ id: 'pm_7' }] }), { status: 200 });
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ error: { message: 'tente de novo' } }), { status: 503 });
    }) as typeof fetch;
    expect(await processRecharges(db, 'sk_test_x', { fetchImpl: flaky })).toMatchObject({ requeued: 1 });
    expect(await a.statuses()).toEqual(['pending']);
    expect(await getAutoRecharge(db, a.t)).toMatchObject({ enabled: true });
    const [attempt] = await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, a.t));
    expect(attempt).toMatchObject({ stripeCustomerId: 'cus_7', paymentMethodId: 'pm_7' });
    // a repetição manda o mesmo cartão (mesma chave de idempotência, mesmos parâmetros)
    await processRecharges(db, 'sk_test_x', { fetchImpl: flaky });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it('400 resource_missing (cartão ou cliente removido no Stripe): falha com o motivo e desliga', async () => {
    const a = await withOpenAttempt('cus_11');
    const missing = (async () =>
      new Response(JSON.stringify({ error: { code: 'resource_missing', message: 'No such customer' } }), {
        status: 400,
      })) as typeof fetch;
    await processRecharges(db, 'sk_test_x', { fetchImpl: missing, limit: 500 });
    expect(await a.statuses()).toEqual(['failed']);
    expect(await getAutoRecharge(db, a.t)).toMatchObject({
      enabled: false,
      lastFailureReason: 'resource_missing',
    });
  });

  it('401 do Stripe (chave trocada ou revogada) não desliga a recarga: volta para a fila', async () => {
    const a = await withOpenAttempt('cus_14');
    const badKey = (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid API Key provided' } }), {
        status: 401,
      })) as typeof fetch;
    // mais rodadas que o teto de tentativas: chave errada é nossa e nunca chega ao teto
    for (let i = 0; i <= MAX_RECHARGE_ATTEMPTS; i++)
      await processRecharges(db, 'sk_test_x', { fetchImpl: badKey, limit: 500 });
    expect(await a.statuses()).toEqual(['pending']);
    const [attempt] = await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, a.t));
    expect(attempt?.attempts).toBe(0);
    expect(await getAutoRecharge(db, a.t)).toMatchObject({ enabled: true, lastFailureReason: null });
  });

  it('falha passageira repetida: no teto de tentativas, falha e desliga a recarga', async () => {
    const a = await withOpenAttempt('cus_12');
    const down = (async () =>
      new Response(JSON.stringify({ error: { message: 'fora' } }), { status: 500 })) as typeof fetch;
    for (let i = 1; i < MAX_RECHARGE_ATTEMPTS; i++)
      await processRecharges(db, 'sk_test_x', { fetchImpl: down, limit: 500 });
    expect(await a.statuses()).toEqual(['pending']);
    await processRecharges(db, 'sk_test_x', { fetchImpl: down, limit: 500 });
    expect(await a.statuses()).toEqual(['failed']);
    expect(await getAutoRecharge(db, a.t)).toMatchObject({
      enabled: false,
      lastFailureReason: 'stripe_unavailable',
    });
  });

  it('recarga paga com valor diferente fica em revisão, sem crédito', async () => {
    const a = await withOpenAttempt('cus_13');
    await processRecharges(db, 'sk_test_x', { fetchImpl: okFetch([]) });
    const [attempt] = await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, a.t));
    const odd = piEvent('payment_intent.succeeded', attempt!.id, attempt!.paymentIntentId!, {
      amount_received: 999,
    });
    expect((await applyStripeEvent(db, odd)).outcome).toBe('amount_mismatch');
    expect(await a.statuses()).toEqual(['review']);
    // a equipe vê a recarga em revisão, com o PaymentIntent para conferir no Stripe
    expect(await listPurchasesInReview(db, a.t)).toEqual([
      expect.objectContaining({ id: attempt!.id, auto: true, paymentIntentId: attempt!.paymentIntentId }),
    ]);
    expect((await getWallet(db, a.t))?.available).toBe(15);
  });

  it('pagamento confirmado depois de a tentativa falhar: credita uma vez', async () => {
    const a = await withOpenAttempt('cus_8');
    await processRecharges(db, 'sk_test_x', { fetchImpl: okFetch([]) });
    const [attempt] = await db.select().from(rechargeAttempt).where(eq(rechargeAttempt.tenantId, a.t));
    await db.update(rechargeAttempt).set({ status: 'failed' }).where(eq(rechargeAttempt.id, attempt!.id));
    const ok = piEvent('payment_intent.succeeded', attempt!.id, attempt!.paymentIntentId!);
    expect((await applyStripeEvent(db, ok)).outcome).toBe('credited');
    expect((await getWallet(db, a.t))?.available).toBe(515);
    expect(await a.statuses()).toEqual(['succeeded']);
  });

  it('tentativa presa em processing: sem pagamento criado volta para a fila; cancelada no Stripe falha', async () => {
    const later = new Date(Date.now() + 60 * 60_000);
    const a = await withOpenAttempt('cus_9');
    await db.update(rechargeAttempt).set({ status: 'processing' }).where(eq(rechargeAttempt.tenantId, a.t));
    const b = await withOpenAttempt('cus_10');
    await db
      .update(rechargeAttempt)
      .set({ status: 'processing', paymentIntentId: 'pi_preso' })
      .where(eq(rechargeAttempt.tenantId, b.t));
    const canceled = (async () =>
      new Response(JSON.stringify({ id: 'pi_preso', status: 'canceled' }), { status: 200 })) as typeof fetch;
    await reconcileStuckRecharges(db, 'sk_test_x', { now: later, fetchImpl: canceled, limit: 500 });
    expect(await a.statuses()).toEqual(['pending']);
    expect(await b.statuses()).toEqual(['failed']);
  });

  it('limiar igual ou acima dos créditos do pacote é recusado; desligar não pede pacote nem limiar', async () => {
    const t = await newTenant();
    await expect(
      configureAutoRecharge(db, {
        tenantId: t,
        enabled: true,
        packageId: pkg,
        thresholdCredits: 500,
        accepted: true,
        userId: 'dono',
      }),
    ).rejects.toSatisfy((e: unknown) => isCosmosError(e, 'invalid_amount'));
    await expect(
      configureAutoRecharge(db, {
        tenantId: t,
        enabled: true,
        packageId: pkg,
        thresholdCredits: 20,
        accepted: true,
        userId: 'dono',
        market: 'BR',
      }),
    ).rejects.toSatisfy((e: unknown) => isCosmosError(e, 'unknown_package'));
    await expect(
      configureAutoRecharge(db, { tenantId: t, enabled: false, accepted: false, userId: 'dono' }),
    ).resolves.toBeUndefined();
  });
});

describe('carteira bloqueada por saldo zerado', () => {
  it('estorno positivo libera a carteira e abre um ciclo novo', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 5 });
    await spend(t, 5);
    expect(await getWallet(db, t)).toMatchObject({ status: 'blocked', blockReason: 'depleted' });
    await addEntry(db, { tenantId: t, kind: 'refund', idempotencyKey: key(), credits: 3 });
    expect(await getWallet(db, t)).toMatchObject({ status: 'active', blockReason: null, available: 3 });
    await expect(reserve(db, { tenantId: t, functionName: 'fn' }, { settings })).resolves.toBeTruthy();
  });

  it('reserva devolvida com saldo livre positivo libera a carteira', async () => {
    const t = await newTenant();
    await addEntry(db, { tenantId: t, kind: 'purchase', idempotencyKey: key(), credits: 3 });
    const r = await reserve(db, { tenantId: t, functionName: 'fn', estimatedCredits: 2 }, { settings });
    await spend(t, 1); // saldo livre 0 com 2 reservados: bloqueia por zerado
    expect(await getWallet(db, t)).toMatchObject({ status: 'blocked', blockReason: 'depleted' });
    await release(db, { tenantId: t, reservationId: r.id });
    expect(await getWallet(db, t)).toMatchObject({ status: 'active', blockReason: null, available: 2 });
  });
});

describe('vencimento do teste com reserva aberta', () => {
  it('a parte do teste que estava reservada vence quando volta para o saldo', async () => {
    const t = await newTenant();
    await enableCosmos(db, t, { trial });
    const r = await reserve(db, { tenantId: t, functionName: 'fn', estimatedCredits: 10 }, { settings });
    const after = new Date(Date.now() + 91 * 86_400_000);
    await expireTrials(db, after, 10_000);
    expect(await getWallet(db, t)).toMatchObject({ available: 0, trialRemaining: 10 });
    await release(db, { tenantId: t, reservationId: r.id });
    expect((await getWallet(db, t))?.available).toBe(10);
    await expireTrials(db, after, 10_000);
    expect(await getWallet(db, t)).toMatchObject({ available: 0, trialRemaining: 0 });
  });
});
