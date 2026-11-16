/**
 * Preço "a partir de" para o assistente de cadastro (PL14), só no servidor: o preço mensal de lista do plano Fan
 * Experience e de cada faixa de capacidade em `billing.price`, no mercado do país ou no genérico (`ZZ`). Preço é
 * dado, nunca código: sem linha cadastrada, a tela não mostra valor nenhum.
 */
import type { CapacityTier } from '@galaxie/billing';

import { pool } from '@/lib/auth/db';
import { SIGNUP_PLAN } from '@/lib/client/provision';

export interface StartingPrice {
  /** Valor na menor unidade da moeda (centavos), por mês. */
  amountMinor: number;
  currency: 'usd' | 'brl';
}

export interface StartingPrices {
  plan: StartingPrice | null;
  capacity: Partial<Record<CapacityTier, StartingPrice>>;
}

export async function readStartingPrices(country: string): Promise<StartingPrices> {
  const market = country.toUpperCase();
  let rows: {
    item_kind: string;
    item_key: string;
    market: string;
    currency: 'usd' | 'brl';
    amount_minor: string;
  }[] = [];
  try {
    rows = (
      await pool.query<{
        item_kind: string;
        item_key: string;
        market: string;
        currency: 'usd' | 'brl';
        amount_minor: string;
      }>(
        `select item_kind, item_key, market, currency, amount_minor::text
           from billing.price
          where active and interval = 'month' and market in ($1, 'ZZ')
            and ((item_kind = 'plan' and item_key = $2) or item_kind = 'capacity')
          order by (market = $1) desc`,
        [market, SIGNUP_PLAN],
      )
    ).rows;
  } catch (err) {
    // tabela ainda não criada (migration pendente): sem preço, a tela não mostra valor
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
  const out: StartingPrices = { plan: null, capacity: {} };
  // a primeira linha de cada item é a do mercado (ordenação acima); a seguinte, a genérica, não substitui
  for (const r of rows) {
    const price = { amountMinor: Number(r.amount_minor), currency: r.currency };
    if (r.item_kind === 'plan') out.plan ??= price;
    else out.capacity[r.item_key as CapacityTier] ??= price;
  }
  return out;
}
