import { describe, expect, it, vi } from 'vitest';

import {
  checkoutForm,
  createCheckoutSession,
  parseStripeEvent,
  paymentMethodsFor,
  signStripePayload,
  verifyStripeSignature,
} from './stripe.js';

const SECRET = 'whsec_teste';

describe('assinatura do webhook', () => {
  const body = '{"id":"evt_1"}';
  const now = new Date('2026-11-10T12:00:00Z');

  it('aceita a assinatura certa dentro da janela', () => {
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, now), SECRET, now)).toBe(true);
  });

  it('aceita quando uma das v1 bate (rotação do segredo)', () => {
    const good = signStripePayload(body, SECRET, now).split(',')[1]!;
    const header = `t=${Math.floor(now.getTime() / 1000)},v1=${'0'.repeat(64)},${good}`;
    expect(verifyStripeSignature(body, header, SECRET, now)).toBe(true);
  });

  it('recusa segredo errado, corpo alterado, fora da janela e cabeçalho torto', () => {
    const sig = signStripePayload(body, SECRET, now);
    expect(verifyStripeSignature(body, sig, 'outro', now)).toBe(false);
    expect(verifyStripeSignature(`${body} `, sig, SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sig, SECRET, new Date(now.getTime() + 301_000))).toBe(false);
    expect(verifyStripeSignature(body, undefined, SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, 'v1=abc', SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sig, '', now)).toBe(false);
  });
});

describe('checkout', () => {
  const input = {
    purchaseIntentId: '01900000-0000-7000-8000-000000000001',
    tenantId: 't1',
    productName: 'Cosmos AI · Pacote',
    amountCents: 4900,
    currency: 'brl' as const,
    successUrl: 'https://app.exemplo/cliente/cosmos?compra=ok',
    cancelUrl: 'https://app.exemplo/cliente/cosmos?compra=cancelada',
    locale: 'pt-BR',
  };

  it('Pix e cartão no Brasil; só cartão em dólar', () => {
    expect(paymentMethodsFor('brl')).toEqual(['card', 'pix']);
    expect(paymentMethodsFor('usd')).toEqual(['card']);
  });

  it('formulário com a intenção nos metadados, recibo e idioma', () => {
    const form = checkoutForm(input);
    expect(form.get('mode')).toBe('payment');
    expect(form.get('metadata[purchase_intent_id]')).toBe(input.purchaseIntentId);
    expect(form.get('client_reference_id')).toBe(input.purchaseIntentId);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('4900');
    expect(form.get('payment_method_types[1]')).toBe('pix');
    expect(form.get('invoice_creation[enabled]')).toBe('true');
    expect(form.get('locale')).toBe('pt-BR');
    expect(checkoutForm({ ...input, locale: 'es-AR' }).get('locale')).toBe('es-419');
  });

  it('chave de idempotência pela intenção; erro do Stripe vira exceção', async () => {
    const ok = vi.fn(
      async () => new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout' }), { status: 200 }),
    );
    await expect(createCheckoutSession('sk_test_x', input, ok)).resolves.toEqual({
      id: 'cs_1',
      url: 'https://checkout',
    });
    const init = (ok.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      `cosmos-checkout-${input.purchaseIntentId}`,
    );
    const fail = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'chave inválida' } }), { status: 401 }),
    );
    await expect(createCheckoutSession('sk_test_x', input, fail)).rejects.toThrow('chave inválida');
  });
});

it('parseStripeEvent recusa o que não é evento', () => {
  expect(parseStripeEvent('nada')).toBeNull();
  expect(parseStripeEvent('{"id":"evt"}')).toBeNull();
  expect(parseStripeEvent('{"id":"evt","type":"x","data":{"object":{"id":"cs"}}}')).toMatchObject({
    id: 'evt',
  });
});
