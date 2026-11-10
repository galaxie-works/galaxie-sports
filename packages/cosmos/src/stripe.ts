/**
 * O pouco do Stripe que a Cosmos usa, sem SDK: abrir o Checkout de um pacote e conferir a assinatura do
 * webhook. Os segredos (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) ficam só no servidor, e o número do
 * cartão nunca passa por aqui: o cliente paga na página do Stripe.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PackageCurrency } from '@galaxie/db/schema';

export const STRIPE_API = 'https://api.stripe.com/v1';

/** Janela aceita entre o carimbo da assinatura e agora (a mesma das bibliotecas do Stripe). */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Confere o cabeçalho `Stripe-Signature` (`t=<unix>,v1=<hmac>`): HMAC-SHA256 de `<t>.<corpo cru>` com o
 * segredo do endpoint, dentro da janela de tempo. O corpo tem de ser o texto exato que chegou.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string | undefined]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k, v]) => k === 'v1' && v).map(([, v]) => v!);
  if (!Number.isInteger(t) || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'utf8');
  return signatures.some((s) => {
    const got = Buffer.from(s, 'utf8');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Assina um corpo como o Stripe assina (testes e ensaio local do webhook). */
export function signStripePayload(rawBody: string, secret: string, now: Date = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

/** Formas de pagamento por moeda: Pix e cartão no Brasil; cartão nos EUA e no Canadá. */
export function paymentMethodsFor(currency: PackageCurrency): readonly string[] {
  return currency === 'brl' ? ['card', 'pix'] : ['card'];
}

/** Idiomas do Checkout que batem com os do app. */
const CHECKOUT_LOCALES: Record<string, string> = { 'pt-BR': 'pt-BR', en: 'en', 'es-AR': 'es-419' };

export interface CheckoutInput {
  purchaseIntentId: string;
  tenantId: string;
  productName: string;
  amountCents: number;
  currency: PackageCurrency;
  successUrl: string;
  cancelUrl: string;
  locale?: string;
  customerEmail?: string;
}

/** Corpo `application/x-www-form-urlencoded` da criação da sessão (separado para o teste). */
export function checkoutForm(input: CheckoutInput): URLSearchParams {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('client_reference_id', input.purchaseIntentId);
  form.set('metadata[purchase_intent_id]', input.purchaseIntentId);
  form.set('metadata[tenant_id]', input.tenantId);
  form.set('payment_intent_data[metadata][purchase_intent_id]', input.purchaseIntentId);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', input.currency);
  form.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
  form.set('line_items[0][price_data][product_data][name]', input.productName);
  paymentMethodsFor(input.currency).forEach((m, i) => form.set(`payment_method_types[${i}]`, m));
  // recibo por compra: o Stripe gera a fatura paga e manda por e-mail
  form.set('invoice_creation[enabled]', 'true');
  form.set('success_url', input.successUrl);
  form.set('cancel_url', input.cancelUrl);
  const locale = input.locale ? CHECKOUT_LOCALES[input.locale] : undefined;
  if (locale) form.set('locale', locale);
  if (input.customerEmail) form.set('customer_email', input.customerEmail);
  return form;
}

export class StripeRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StripeRequestError';
  }
}

/**
 * Abre a sessão do Checkout. A chave de idempotência é a intenção de compra: repetir o pedido (clique
 * duplo, nova tentativa) devolve a mesma sessão em vez de abrir outra.
 */
export async function createCheckoutSession(
  secretKey: string,
  input: CheckoutInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; url: string }> {
  const res = await fetchImpl(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `cosmos-checkout-${input.purchaseIntentId}`,
    },
    body: checkoutForm(input),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.id || !body.url)
    throw new StripeRequestError(res.status, body?.error?.message ?? `Stripe respondeu ${res.status}`);
  return { id: body.id, url: body.url };
}

/** Evento do webhook, só com o que a Cosmos lê. */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripeCheckoutSession };
}

export interface StripeCheckoutSession {
  id: string;
  object?: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | null;
  invoice?: string | null;
}

/** Lê o corpo cru do webhook; formato inesperado → null (responde 400). */
export function parseStripeEvent(rawBody: string): StripeEvent | null {
  try {
    const v = JSON.parse(rawBody) as Partial<StripeEvent>;
    if (typeof v.id !== 'string' || typeof v.type !== 'string' || typeof v.data?.object !== 'object')
      return null;
    return v as StripeEvent;
  } catch {
    return null;
  }
}
