import { randomBytes } from 'node:crypto';
import { purchaseIntent, tenant, type Database } from '@galaxie/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyStripeEvent,
  attachCheckoutSession,
  createPurchaseIntent,
  getPurchaseIntent,
  getWallet,
  isCosmosError,
  listLedger,
  listPackages,
  upsertPackage,
  type StripeCheckoutSession,
  type StripeEvent,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;
let brPackage: string;

async function newTenant(): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'enterprise', modules: ['core_data'] })
    .returning({ id: tenant.id });
  return row!.id;
}

let seq = 0;
const evt = (type: string, session: StripeCheckoutSession): StripeEvent => ({
  id: `evt_${++seq}_${randomBytes(3).toString('hex')}`,
  type,
  data: { object: session },
});

/** Intenção com a sessão já ligada, como o painel deixa antes de mandar para o Stripe. */
async function intentFor(t: string) {
  const { id } = await createPurchaseIntent(db, {
    tenantId: t,
    packageId: brPackage,
    market: 'BR',
    userId: 'u1',
  });
  const sessionId = `cs_${randomBytes(4).toString('hex')}`;
  await attachCheckoutSession(db, { tenantId: t, purchaseIntentId: id, checkoutSessionId: sessionId });
  const session: StripeCheckoutSession = {
    id: sessionId,
    metadata: { purchase_intent_id: id },
    client_reference_id: id,
    amount_total: 4900,
    currency: 'brl',
    payment_intent: 'pi_1',
  };
  return { id, session };
}

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
  // preços de teste, não os da tabela da Galaxie
  brPackage = await upsertPackage(db, {
    name: 'Teste',
    credits: 1000,
    priceCents: 4900,
    currency: 'brl',
    market: 'br',
  });
  await upsertPackage(db, {
    name: 'Teste US',
    credits: 1000,
    priceCents: 900,
    currency: 'usd',
    market: 'US',
  });
});

afterAll(async () => {
  await temp?.close();
});

describe('compra de créditos pelo Stripe', () => {
  it('pacotes só do mercado do cliente', async () => {
    expect((await listPackages(db, 'BR')).map((p) => p.currency)).toEqual(['brl']);
    expect((await listPackages(db, 'us')).map((p) => p.currency)).toEqual(['usd']);
    const t = await newTenant();
    await expect(
      createPurchaseIntent(db, { tenantId: t, packageId: brPackage, market: 'US' }),
    ).rejects.toSatisfy((e: unknown) => isCosmosError(e, 'unknown_package'));
  });

  it('cartão pago credita uma vez; o mesmo evento repetido é ignorado', async () => {
    const t = await newTenant();
    const { id, session } = await intentFor(t);
    const event = evt('checkout.session.completed', { ...session, payment_status: 'paid' });
    expect(await applyStripeEvent(db, event)).toMatchObject({ outcome: 'credited', purchaseIntentId: id });
    // o Stripe reenvia o mesmo evento, até ao mesmo tempo
    const again = await Promise.all([applyStripeEvent(db, event), applyStripeEvent(db, event)]);
    expect(again.map((r) => r.outcome)).toEqual(['duplicate', 'duplicate']);
    expect(await getWallet(db, t)).toMatchObject({ available: 1000, receivedTotal: 1000 });
    expect(await getPurchaseIntent(db, t, id)).toMatchObject({ status: 'paid' });
    const { entries } = await listLedger(db, t, { kinds: ['purchase'] });
    expect(entries).toHaveLength(1);
  });

  it('Pix: o checkout completo não credita; o pagamento confirmado depois credita; outro evento não credita de novo', async () => {
    const t = await newTenant();
    const { session } = await intentFor(t);
    expect(
      (
        await applyStripeEvent(
          db,
          evt('checkout.session.completed', { ...session, payment_status: 'unpaid' }),
        )
      ).outcome,
    ).toBe('awaiting_payment');
    expect((await getWallet(db, t))?.available ?? 0).toBe(0);
    expect(
      (await applyStripeEvent(db, evt('checkout.session.async_payment_succeeded', session))).outcome,
    ).toBe('credited');
    expect(
      (await applyStripeEvent(db, evt('checkout.session.async_payment_succeeded', session))).outcome,
    ).toBe('already_closed');
    expect((await getWallet(db, t))?.available).toBe(1000);
  });

  it('falha, expiração e valor diferente não creditam nada', async () => {
    const t = await newTenant();
    const a = await intentFor(t);
    expect(
      (await applyStripeEvent(db, evt('checkout.session.async_payment_failed', a.session))).outcome,
    ).toBe('failed');
    const b = await intentFor(t);
    expect((await applyStripeEvent(db, evt('checkout.session.expired', b.session))).outcome).toBe('expired');
    const c = await intentFor(t);
    expect(
      (
        await applyStripeEvent(
          db,
          evt('checkout.session.completed', { ...c.session, payment_status: 'paid', amount_total: 100 }),
        )
      ).outcome,
    ).toBe('amount_mismatch');
    expect((await getWallet(db, t))?.available ?? 0).toBe(0);
    const rows = await db.select().from(purchaseIntent).where(eq(purchaseIntent.tenantId, t));
    // valor diferente fica para a equipe revisar, não como falha silenciosa
    expect(rows.map((r) => r.status).sort()).toEqual(['expired', 'failed', 'review']);
  });

  it('com conversão de moeda no Checkout, vale o valor de origem', async () => {
    const t = await newTenant();
    const { session } = await intentFor(t);
    const converted = {
      ...session,
      payment_status: 'paid' as const,
      amount_total: 1371,
      currency: 'cad',
      currency_conversion: { amount_total: 4900, source_currency: 'brl' },
    };
    expect((await applyStripeEvent(db, evt('checkout.session.completed', converted))).outcome).toBe(
      'credited',
    );
  });

  it('sessão que não é nossa ou de outra intenção não credita', async () => {
    const t = await newTenant();
    const { session } = await intentFor(t);
    expect(
      (
        await applyStripeEvent(
          db,
          evt('checkout.session.completed', { id: 'cs_outro', payment_status: 'paid' }),
        )
      ).outcome,
    ).toBe('unknown_intent');
    expect(
      (
        await applyStripeEvent(
          db,
          evt('checkout.session.completed', { ...session, id: 'cs_trocada', payment_status: 'paid' }),
        )
      ).outcome,
    ).toBe('unknown_intent');
    expect((await applyStripeEvent(db, evt('invoice.paid', session))).outcome).toBe('ignored');
    // 36 caracteres hex sem hífens: não é uuid para o Postgres; vira unknown_intent (200), não erro (500)
    const hex = randomBytes(18).toString('hex');
    expect(hex).toHaveLength(36);
    for (const metadata of [{ purchase_intent_id: hex }, { purchase_intent_id: '-'.repeat(36) }])
      expect(
        (
          await applyStripeEvent(
            db,
            evt('checkout.session.completed', { id: 'cs_x', metadata, payment_status: 'paid' }),
          )
        ).outcome,
      ).toBe('unknown_intent');
    expect((await getWallet(db, t))?.available ?? 0).toBe(0);
  });
});
