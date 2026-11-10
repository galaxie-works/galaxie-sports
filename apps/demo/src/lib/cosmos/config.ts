/**
 * Regras puras da compra de créditos da Cosmos no painel (testáveis sem sessão nem Stripe).
 */
import type { ClientContext } from '@/lib/client/session';

/**
 * Quem pode comprar créditos. Antes dos cargos (#1019), vale a checagem que já existe no painel: a equipe
 * Galaxie (admin) e a conta do cliente ligada ao tenant.
 * TODO(#1019): só o dono e quem tiver a permissão de cobrança do cargo.
 */
export function canBuyCredits(ctx: Pick<ClientContext, 'role' | 'tenant'>): boolean {
  return Boolean(ctx.tenant) && (ctx.role === 'admin' || ctx.role === 'client');
}

/** Mercados com tabela própria de pacotes (BR em reais; EUA e Canadá em dólar). */
const PACKAGE_MARKETS = ['BR', 'US', 'CA'] as const;

/**
 * Mercado dos pacotes do tenant: o primeiro dos mercados contratados com tabela própria; sem nenhum
 * (lista vazia = todos os mercados, ou só países sem tabela), o Brasil.
 */
export function packageMarket(markets: readonly string[]): string {
  const upper = markets.map((m) => m.toUpperCase());
  return PACKAGE_MARKETS.find((m) => upper.includes(m)) ?? 'BR';
}

/** Chave secreta do Stripe (só no servidor); vazia = compra indisponível. */
export function stripeSecretKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.STRIPE_SECRET_KEY?.trim() || null;
}

/** Volta do Checkout para a área da Cosmos, com a intenção para o passo "processando". */
export function checkoutUrls(
  purchaseIntentId: string,
  env: Record<string, string | undefined> = process.env,
): { success: string; cancel: string } {
  const base = (env.BETTER_AUTH_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  const page = `${base}/cliente/cosmos`;
  return {
    success: `${page}?purchase=${purchaseIntentId}&status=success`,
    cancel: `${page}?purchase=${purchaseIntentId}&status=canceled`,
  };
}
