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
  /**
   * Recarga automática ligada (com aceite): salva o cartão para cobranças fora da sessão. Só cartão, porque o
   * Pix não guarda forma de pagamento.
   */
  saveCard?: boolean;
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
  const methods = input.saveCard ? ['card'] : paymentMethodsFor(input.currency);
  methods.forEach((m, i) => form.set(`payment_method_types[${i}]`, m));
  if (input.saveCard) {
    form.set('customer_creation', 'always');
    form.set('payment_intent_data[setup_future_usage]', 'off_session');
    form.set('metadata[save_card]', 'true');
  }
  // preço só na moeda do pacote: a conversão automática do Stripe mudaria valor e moeda da sessão
  form.set('adaptive_pricing[enabled]', 'false');
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
  /** Com conversão de moeda no Checkout: o valor e a moeda de origem (os do nosso preço). */
  currency_conversion?: { amount_total?: number | null; source_currency?: string | null } | null;
  payment_intent?: string | null;
  invoice?: string | null;
  /** Cliente do Stripe (compra com a recarga automática ligada salva o cartão nele). */
  customer?: string | null;
  /** PaymentIntent da recarga automática. */
  amount?: number | null;
  amount_received?: number | null;
  status?: string | null;
  last_payment_error?: { code?: string; decline_code?: string; message?: string } | null;
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

async function stripeRequest<T>(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  fetchImpl: typeof fetch,
  body?: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const res = await fetchImpl(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { message?: string; code?: string } }) | null;
  if (!res.ok || !json) {
    const err = new StripeRequestError(res.status, json?.error?.message ?? `Stripe respondeu ${res.status}`);
    (err as StripeRequestError & { code?: string | undefined }).code = json?.error?.code;
    throw err;
  }
  return json;
}

export interface OffSessionChargeInput {
  rechargeAttemptId: string;
  tenantId: string;
  customerId: string;
  /** Cartão salvo (`defaultCardOf`), gravado na tentativa para a repetição mandar o mesmo. */
  paymentMethodId: string;
  amountCents: number;
  currency: PackageCurrency;
  description: string;
}

/** Primeiro cartão salvo do cliente no Stripe; null quando não há. */
export async function defaultCardOf(
  secretKey: string,
  customerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const methods = await stripeRequest<{ data?: { id: string }[] }>(
    secretKey,
    'GET',
    `/customers/${encodeURIComponent(customerId)}/payment_methods?type=card&limit=1`,
    fetchImpl,
  );
  return methods.data?.[0]?.id ?? null;
}

/** Estado de um PaymentIntent (conciliação da tentativa que ficou presa em `processing`). */
export async function getPaymentIntent(
  secretKey: string,
  paymentIntentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; status: string; amount_received?: number; amount?: number; currency?: string }> {
  return stripeRequest(
    secretKey,
    'GET',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    fetchImpl,
  );
}

/**
 * Recusa definitiva da cobrança (cartão recusado, autenticação exigida): a recarga se desliga. Qualquer outra
 * falha (5xx, 409, 429, rede) é passageira: a tentativa volta para a fila e repete com a mesma chave.
 */
export function isDefinitiveDecline(e: unknown): boolean {
  if (!(e instanceof StripeRequestError)) return false;
  const code = (e as StripeRequestError & { code?: string | undefined }).code;
  if (code && ['card_declined', 'authentication_required', 'expired_card', 'incorrect_cvc'].includes(code))
    return true;
  return e.status === 402;
}

/**
 * Cobra a recarga automática no cartão salvo do cliente, fora da sessão. A chave de idempotência é a tentativa:
 * repetir não cobra duas vezes. O crédito não sai daqui: entra pelo webhook `payment_intent.succeeded`.
 */
export async function chargeOffSession(
  secretKey: string,
  input: OffSessionChargeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ paymentIntentId: string; status: string }> {
  const paymentMethod = input.paymentMethodId;
  const form = new URLSearchParams();
  form.set('amount', String(input.amountCents));
  form.set('currency', input.currency);
  form.set('customer', input.customerId);
  form.set('payment_method', paymentMethod);
  form.set('off_session', 'true');
  form.set('confirm', 'true');
  form.set('description', input.description);
  form.set('metadata[recharge_attempt_id]', input.rechargeAttemptId);
  form.set('metadata[tenant_id]', input.tenantId);
  const pi = await stripeRequest<{ id: string; status: string }>(
    secretKey,
    'POST',
    '/payment_intents',
    fetchImpl,
    form,
    `cosmos-recharge-${input.rechargeAttemptId}`,
  );
  return { paymentIntentId: pi.id, status: pi.status };
}
