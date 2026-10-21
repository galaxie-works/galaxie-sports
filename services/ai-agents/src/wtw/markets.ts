import { and, eq, sql } from 'drizzle-orm';
import { tenant, type Database } from '@galaxie/db';
import { WTW_COUNTRIES } from '@galaxie/where-to-watch';

/**
 * Mercados ativos do onde assistir:
 * 1. `WTW_MARKETS` (ex.: "BR,AR") quando definido;
 * 2. senão, a união de `api.tenant.markets` dos tenants ativos com o módulo where_to_watch
 *    (um tenant com lista vazia = todos os mercados);
 * 3. sem tenant com o módulo → nenhum mercado (nada roda e nada custa).
 */
export async function activeMarkets(
  db: Database,
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const supported = new Set<string>(WTW_COUNTRIES);
  const fromEnv = env.WTW_MARKETS?.split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (fromEnv?.length) return [...new Set(fromEnv.filter((c) => supported.has(c)))];
  const rows = await db
    .select({ markets: tenant.markets })
    .from(tenant)
    .where(and(eq(tenant.status, 'active'), sql`'where_to_watch' = any(${tenant.modules})`));
  if (rows.some((r) => r.markets.length === 0)) return [...WTW_COUNTRIES];
  return [...new Set(rows.flatMap((r) => r.markets.map((m) => m.toUpperCase())))]
    .filter((c) => supported.has(c))
    .sort();
}
