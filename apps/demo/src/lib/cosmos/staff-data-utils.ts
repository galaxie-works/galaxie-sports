import type { WalletOverviewRow } from '@galaxie/cosmos';

/**
 * Margem em US$ no período: receita (dólar direto, reais pela cotação) menos o custo real. null quando há receita em
 * reais sem cotação: um número pela metade enganaria.
 */
export function marginUsd(row: Pick<WalletOverviewRow, 'revenueCents' | 'costUsd'>, usdBrl: number | null) {
  if (row.revenueCents.brl > 0 && usdBrl === null) return null;
  const revenue = row.revenueCents.usd / 100 + (usdBrl ? row.revenueCents.brl / 100 / usdBrl : 0);
  return Math.round((revenue - row.costUsd) * 100) / 100;
}
