import { signStripePayload } from '@galaxie/cosmos';
import type { Database } from '@galaxie/db';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../../server.js';
import { COSMOS_STRIPE_WEBHOOK_PATH } from './cosmos-stripe.js';

const SECRET = 'whsec_teste_local';
const body = JSON.stringify({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_1' } },
});

const post = async (opts: { secret?: string; signature?: string; payload?: string }) => {
  const app = buildServer({
    db: {} as Database,
    usage: false,
    cosmos: { stripeWebhookSecret: opts.secret ?? '' },
  });
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url: COSMOS_STRIPE_WEBHOOK_PATH,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(opts.signature ? { 'stripe-signature': opts.signature } : {}),
    },
    payload: opts.payload ?? body,
  });
  await app.close();
  return res;
};

describe(`POST ${COSMOS_STRIPE_WEBHOOK_PATH}`, () => {
  it('sem o segredo configurado responde 503 (o Stripe tenta de novo)', async () => {
    expect((await post({ signature: signStripePayload(body, SECRET) })).statusCode).toBe(503);
  });

  it('sem assinatura, com assinatura errada ou vencida responde 401 e não toca no banco', async () => {
    expect((await post({ secret: SECRET })).statusCode).toBe(401);
    expect((await post({ secret: SECRET, signature: signStripePayload(body, 'outro') })).statusCode).toBe(
      401,
    );
    const old = new Date(Date.now() - 3_600_000);
    expect((await post({ secret: SECRET, signature: signStripePayload(body, SECRET, old) })).statusCode).toBe(
      401,
    );
    // corpo alterado depois de assinado
    const signed = signStripePayload(body, SECRET);
    expect(
      (await post({ secret: SECRET, signature: signed, payload: body.replace('evt_1', 'evt_2') })).statusCode,
    ).toBe(401);
  });

  it('assinatura certa com corpo que não é evento responde 400', async () => {
    const payload = '{"oi":1}';
    expect(
      (await post({ secret: SECRET, signature: signStripePayload(payload, SECRET), payload })).statusCode,
    ).toBe(400);
  });
});
