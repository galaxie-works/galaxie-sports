/**
 * Tenants da API lidos pela demo (só no servidor). Os tenants vivem no schema `api` do mesmo Postgres
 * (`api.tenant`, criados pelas rotas `/internal/admin/tenants` ou por `pnpm --filter @galaxie/api
 * tenant:create`); a demo só lê: plano, módulos, mercados, esportes, limites e o uso consolidado por dia
 * (`api.usage_daily`). Nada daqui exige a chave administrativa da API.
 */
import { pool } from '@/lib/auth/db';

/** Opção de tenant (seletores do admin). */
export interface TenantOption {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
}

export interface TenantInfo extends TenantOption {
  plan: string;
  modules: string[];
  /** Países (ISO2) contratados; vazio = todos os mercados. */
  markets: string[];
  /** Esportes (slug) contratados; vazio = todos. */
  sports: string[];
  rateLimitPerMinute: number;
  /** Cota diária (todas as rotas); null = sem cota. */
  dailyRequestQuota: number | null;
}

export interface TenantUsage {
  /** Requisições de hoje (UTC) já consolidadas. */
  today: number;
  /** Soma do período. */
  total: number;
  /** Um item por dia com uso, do mais antigo ao mais novo (dia em UTC, `YYYY-MM-DD`). */
  days: { day: string; total: number }[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/** Banco sem o schema da API (migrations não rodaram): a demo segue, sem tenants. */
const isMissingTable = (err: unknown) => (err as { code?: string }).code === '42P01';

async function rows<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return (await pool.query<T>(sql, params)).rows;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function listTenantOptions(): Promise<TenantOption[]> {
  return rows<TenantOption>(
    `select id::text, slug, name, status::text as status from api.tenant order by name, slug`,
  );
}

export async function getTenantInfo(id: string): Promise<TenantInfo | null> {
  if (!isUuid(id)) return null;
  const [row] = await rows<TenantInfo>(
    `select id::text, slug, name, status::text as status, plan, modules, markets, sports,
            rate_limit_per_minute as "rateLimitPerMinute", daily_request_quota as "dailyRequestQuota"
       from api.tenant where id = $1`,
    [id],
  );
  return row ?? null;
}

export async function tenantExists(id: string): Promise<boolean> {
  return (await getTenantInfo(id)) !== null;
}

/** Uso consolidado dos últimos `days` dias (o contador ao vivo fica no Valkey e entra aqui em lotes). */
export async function getTenantUsage(id: string, days = 30): Promise<TenantUsage> {
  if (!isUuid(id)) return { today: 0, total: 0, days: [] };
  const list = await rows<{ day: string; total: string }>(
    `select day::text as day, sum(requests)::text as total
       from api.usage_daily
      where tenant_id = $1 and day > (now() at time zone 'utc')::date - $2::int
      group by day order by day`,
    [id, days],
  );
  const today = new Date().toISOString().slice(0, 10);
  const byDay = list.map((r) => ({ day: r.day, total: Number(r.total) }));
  return {
    today: byDay.find((d) => d.day === today)?.total ?? 0,
    total: byDay.reduce((n, d) => n + d.total, 0),
    days: byDay,
  };
}
