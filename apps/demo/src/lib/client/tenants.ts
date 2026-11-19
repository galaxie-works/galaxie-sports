/**
 * Tenants da API lidos pela demo (só no servidor). Os tenants vivem no schema `api` do mesmo Postgres
 * (`api.tenant`, criados pelas rotas `/internal/admin/tenants` ou por `pnpm --filter @galaxie/api
 * tenant:create`); a demo só lê: plano, módulos, mercados, esportes, limites e o uso consolidado por dia
 * (`api.usage_daily`). Nada daqui exige a chave administrativa da API.
 */
import {
  ENGAGE_MODULES,
  isValidModuleLimit,
  MODULE_LIMIT_KEYS,
  type EngageModule,
  type ModuleLimitKey,
  type ModuleUsageMetric,
} from '@galaxie/db/engage-modules';
import type { TenantState } from '@galaxie/db/schema';

import { effectiveState } from '@galaxie/billing';

import { pool } from '@/lib/auth/db';
import { moduleLimits } from '@/lib/client/entitlements';

/** Opção de tenant (seletor de marca da equipe e do cliente com mais de uma marca). */
export interface TenantOption {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  /** A marca é da própria Galaxie (`billing.organization.is_galaxie`): a equipe age sem motivo. */
  isGalaxie: boolean;
}

export interface TenantInfo extends TenantOption {
  /** Organização que assina e paga (`billing.organization`, F2); null só até a migration de dados rodar. */
  organizationId: string | null;
  organizationName: string | null;
  /**
   * Estado do ciclo de vida (F3) que vale agora: a coluna, com o mesmo fallback da API e dos direitos (`effectiveState`:
   * `trial` com `trial_ends_at` vencido conta como `trial_expired` até o job `tenant.lifecycle` gravar a transição). O
   * console mostra e restringe o menu por ele; `status` é só o espelho.
   */
  state: TenantState;
  /** Desde quando está no estado (ISO 8601). */
  stateSince: string;
  /** Prazo do estado `trial` (ISO 8601); null sem prazo. */
  trialEndsAt: string | null;
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
    `select t.id::text, t.slug, t.name, t.status::text as status, coalesce(o.is_galaxie, false) as "isGalaxie"
       from api.tenant t left join billing.organization o on o.id = t.organization_id
      order by t.name, t.slug`,
  );
}

export async function getTenantInfo(id: string): Promise<TenantInfo | null> {
  if (!isUuid(id)) return null;
  const [row] = await rows<TenantInfo>(
    `select t.id::text, t.slug, t.name, t.status::text as status, t.plan, t.modules, t.markets, t.sports,
            t.rate_limit_per_minute as "rateLimitPerMinute", t.daily_request_quota as "dailyRequestQuota",
            t.organization_id::text as "organizationId", o.name as "organizationName",
            coalesce(o.is_galaxie, false) as "isGalaxie",
            t.state, to_char(t.state_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "stateSince",
            to_char(t.trial_ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "trialEndsAt"
       from api.tenant t left join billing.organization o on o.id = t.organization_id
      where t.id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    ...row,
    state: effectiveState(
      { state: row.state, trialEndsAt: row.trialEndsAt ? new Date(row.trialEndsAt) : null },
      new Date(),
    ),
  };
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

/** Faixa de um módulo de engajamento no tenant (#1018): a gravada ou o padrão da Galaxie. */
export interface EngageLimit {
  key: ModuleLimitKey;
  value: number;
  custom: boolean;
}

/** Módulo de engajamento do tenant, com faixas e o uso do mês (consolidado a cada 5 min). */
export interface EngageModuleInfo {
  module: EngageModule;
  limits: EngageLimit[];
  usage: Partial<Record<ModuleUsageMetric, number>>;
}

/** Módulos de engajamento contratados, com faixas e uso do mês corrente (UTC). Vazio = nenhum contratado. */
export async function getEngageModules(
  tenant: Pick<TenantInfo, 'id' | 'modules'>,
): Promise<EngageModuleInfo[]> {
  const modules = ENGAGE_MODULES.filter((m) => tenant.modules.includes(m));
  if (!modules.length || !isUuid(tenant.id)) return [];
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const [saved, usage] = await Promise.all([
    rows<{ key: string; value: number }>(
      `select key, value from api.tenant_module_limit where tenant_id = $1`,
      [tenant.id],
    ),
    rows<{ module: string; metric: string; value: string }>(
      `select module, metric, value::text from api.module_usage_monthly where tenant_id = $1 and month = $2::date`,
      [tenant.id, month],
    ),
  ]);
  const byKey = new Map(saved.map((r) => [r.key, r.value]));
  const defs = moduleLimits();
  return modules.map((module) => ({
    module,
    limits: MODULE_LIMIT_KEYS.filter((k) => defs[k].module === module).map((key) => {
      const v = byKey.get(key);
      const ok = v !== undefined && isValidModuleLimit(defs[key], v);
      return { key, value: ok ? v : defs[key].default, custom: ok };
    }),
    usage: Object.fromEntries(
      usage.filter((u) => u.module === module).map((u) => [u.metric, Number(u.value)]),
    ) as EngageModuleInfo['usage'],
  }));
}
