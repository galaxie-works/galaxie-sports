'use server';

/**
 * Compra de créditos da Cosmos AI (#993) no painel do cliente: cria a intenção de compra e abre o Checkout do
 * Stripe. O tenant sai sempre da sessão (`readClientContext`), nunca do navegador; o crédito só entra depois,
 * pelo webhook da API com o pagamento confirmado. A chave secreta do Stripe fica só no servidor.
 */
import {
  attachCheckoutSession,
  createCheckoutSession,
  createPurchaseIntent,
  getPurchaseIntent,
  isCosmosError,
  listPackages,
  type CreditPackageView,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import { readClientContext, type ClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

import { canBuyCredits, checkoutUrls, packageMarket, stripeSecretKey } from './config';

async function texts() {
  const locale = await getRequestLocale();
  return { locale, t: getDictionary(locale).cosmos.checkout };
}

type Gate =
  | { error: string }
  | {
      ctx: ClientContext & { tenant: NonNullable<ClientContext['tenant']> };
      locale: string;
      t: Awaited<ReturnType<typeof texts>>['t'];
    };

async function gate(): Promise<Gate> {
  const [ctx, { locale, t }] = await Promise.all([readClientContext(), texts()]);
  if (!ctx) return { error: t.errors.forbidden };
  if (!ctx.tenant) return { error: t.errors.noTenant };
  // TODO(#1019): trocar pela permissão de cobrança do cargo (B2) quando os cargos existirem
  if (!canBuyCredits(ctx)) return { error: t.errors.notAllowed };
  return { ctx: { ...ctx, tenant: ctx.tenant }, locale, t };
}

/** Pacotes à venda no mercado do cliente (a janela de compra do #995 lista estes). */
export async function listCosmosPackages(): Promise<{
  ok: boolean;
  packages?: CreditPackageView[];
  error?: string;
}> {
  const g = await gate();
  if ('error' in g) return { ok: false, error: g.error };
  return { ok: true, packages: await listPackages(builderDb(), packageMarket(g.ctx.tenant.markets)) };
}

export interface CheckoutResult {
  ok: boolean;
  /** Página do Checkout do Stripe, para onde o navegador vai. */
  url?: string;
  purchaseIntentId?: string;
  error?: string;
}

/** Cria a intenção de compra e abre o Checkout do pacote escolhido. */
export async function startCosmosCheckout(packageId: string): Promise<CheckoutResult> {
  const g = await gate();
  if ('error' in g) return { ok: false, error: g.error };
  const { ctx, locale, t } = g;
  if (!isUuid(packageId)) return { ok: false, error: t.errors.unknownPackage };
  const secret = stripeSecretKey();
  if (!secret) return { ok: false, error: t.errors.unavailable };

  const db = builderDb();
  try {
    const intent = await createPurchaseIntent(db, {
      tenantId: ctx.tenant.id,
      packageId,
      market: packageMarket(ctx.tenant.markets),
      userId: ctx.userId,
    });
    const urls = checkoutUrls(intent.id);
    const session = await createCheckoutSession(secret, {
      purchaseIntentId: intent.id,
      tenantId: ctx.tenant.id,
      productName: fill(t.productName, { name: intent.package.name, credits: intent.package.credits }),
      amountCents: intent.package.priceCents,
      currency: intent.package.currency,
      successUrl: urls.success,
      cancelUrl: urls.cancel,
      locale,
      customerEmail: ctx.email,
    });
    await attachCheckoutSession(db, {
      tenantId: ctx.tenant.id,
      purchaseIntentId: intent.id,
      checkoutSessionId: session.id,
    });
    return { ok: true, url: session.url, purchaseIntentId: intent.id };
  } catch (err) {
    if (isCosmosError(err, 'unknown_package')) return { ok: false, error: t.errors.unknownPackage };
    console.error('[cosmos] checkout do Stripe falhou', err);
    return { ok: false, error: t.errors.generic };
  }
}

/** Situação da compra na volta do Checkout (o passo "processando" pergunta até sair de `pending`). */
export async function cosmosPurchaseStatus(
  purchaseIntentId: string,
): Promise<{ ok: boolean; status?: string; credits?: number; error?: string }> {
  const g = await gate();
  if ('error' in g) return { ok: false, error: g.error };
  if (!isUuid(purchaseIntentId)) return { ok: false, error: g.t.errors.generic };
  const row = await getPurchaseIntent(builderDb(), g.ctx.tenant.id, purchaseIntentId);
  if (!row) return { ok: false, error: g.t.errors.generic };
  return { ok: true, status: row.status, credits: row.credits };
}
