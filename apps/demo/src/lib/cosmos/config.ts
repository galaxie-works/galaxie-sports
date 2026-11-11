/**
 * Regras puras da compra de créditos da Cosmos no painel (testáveis sem sessão nem Stripe).
 */
import { can, type PermissionContext } from '@/lib/client/permissions';

/** Ações da Cosmos AI no painel do cliente: ver (tela, saldo, extrato, CSV) e gerenciar (comprar, recarga, ligar). */
export type CosmosPanelAction = 'cosmos.view' | 'cosmos.manage';

/**
 * Por que a sessão não pode fazer `action` na Cosmos do tenant em foco, ou null quando pode. O cargo vem da sessão
 * (`readClientContext`), nunca do navegador; a equipe Galaxie passa por cima (`galaxie_staff`).
 */
export function cosmosAccessError(
  ctx: PermissionContext | null,
  action: CosmosPanelAction,
): 'forbidden' | 'noTenant' | 'role' | null {
  if (!ctx) return 'forbidden';
  if (!ctx.tenant || !ctx.actor) return 'noTenant';
  return can(ctx, action) ? null : 'role';
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
