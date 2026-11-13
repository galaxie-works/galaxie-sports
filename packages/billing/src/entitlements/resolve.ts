import { createHash } from 'node:crypto';
import type { ApiModule, ApiPlan, ModuleLimitKey, OverrideKind } from '@galaxie/db/schema';
import {
  featuresFor,
  isValidTierValue,
  meetsRequirement,
  tierIndex,
  type Catalog,
} from '../catalog/catalog.js';
import type { CapacityTier } from '../catalog/schema.js';

/**
 * Estado do tenant. A F1 deriva só `trial`, `active`, `suspended` e `trial_expired` das colunas de hoje; `past_due` e
 * `cancelled` entram com a máquina de estados da F3. Os estados que desligam tudo estão em `STATES_WITHOUT_ACCESS`.
 */
export const TENANT_STATES = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'trial_expired',
] as const;
export type TenantState = (typeof TENANT_STATES)[number];
export const STATES_WITHOUT_ACCESS: readonly TenantState[] = ['suspended', 'cancelled', 'trial_expired'];

/** O que o banco diz do tenant (só o que a resolução usa). */
export type TenantRow = {
  id: string;
  plan: ApiPlan;
  modules: ApiModule[];
  markets: string[];
  sports: string[];
  rateLimitPerMinute: number;
  dailyRequestQuota: number | null;
  trialEndsAt: Date | null;
  status: 'active' | 'suspended';
  catalogVersion: string | null;
  capacityTier: CapacityTier | null;
};

export type OverrideRow = {
  id: string;
  kind: OverrideKind;
  key: string;
  value: number | null;
  validUntil: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

export type EntitlementInputs = {
  tenant: TenantRow;
  /** `api.tenant_module_limit`: a faixa que a Galaxie ou o cliente escolheu para o módulo. */
  moduleLimits: { key: ModuleLimitKey | string; value: number }[];
  overrides: OverrideRow[];
  /** Carteira da Cosmos; null = o tenant nunca teve carteira. */
  wallet: { available: number; status: 'active' | 'blocked' } | null;
};

export type Entitlements = {
  tenantId: string;
  /** O tenant da Galaxie (cliente zero) consome tudo sem cobrança. */
  isGalaxie: boolean;
  state: TenantState;
  plan: ApiPlan;
  /** O que vale agora, já com exceções e estado (estado sem acesso = nenhum módulo). */
  modules: ApiModule[];
  /** Derivadas dos módulos e do plano, mais as exceções. */
  features: string[];
  /** `live_chat.peak_connections` → 25000. */
  tiers: Record<string, number>;
  /** Unidades de add-on contratadas: `where_to_watch.extra_markets` → 2. */
  addons: Record<string, number>;
  /** Faixa de capacidade (por ora do tenant; da organização quando a F2 trouxer a organização). */
  capacity: {
    tier: CapacityTier;
    viewsPerMonth: number | null;
    peakConcurrent: number | null;
    chatWriters: number | null;
  };
  /** Países; [] = todos. */
  markets: string[];
  /** Esportes; [] = todos. */
  sports: string[];
  limits: { rateLimitPerMinute: number; dailyRequestQuota: number | null };
  credits: { available: number; status: 'active' | 'blocked' } | null;
  trialEndsAt: string | null;
  /** Versão do catálogo que o tenant assinou (ou a atual, para tenant anterior ao catálogo). */
  catalogVersion: string;
  /** O que no dado do tenant não bate com o catálogo (exceção com chave desconhecida, dependência que falta). */
  warnings: string[];
  /** Impressão digital do conteúdo acima: muda a cada mudança de direito (cache e eventos). */
  version: string;
};

export type ResolveOptions = {
  now?: Date;
  /** Ids dos tenants da Galaxie. */
  galaxieTenantIds?: readonly string[];
};

function deriveState(t: TenantRow, now: Date): TenantState {
  if (t.status === 'suspended') return 'suspended';
  if (t.trialEndsAt && t.trialEndsAt.getTime() <= now.getTime()) return 'trial_expired';
  if (t.trialEndsAt || t.plan === 'trial') return 'trial';
  return 'active';
}

/** Função pura: junta catálogo, tenant, faixas, exceções e carteira numa resposta de direitos. */
export function resolveEntitlements(
  catalog: Catalog,
  input: EntitlementInputs,
  opts: ResolveOptions = {},
): Entitlements {
  const now = opts.now ?? new Date();
  const { tenant } = input;
  const warnings: string[] = [];
  const state = deriveState(tenant, now);
  // precedência entre exceções que se contradizem (conceder e retirar o mesmo módulo, duas faixas): vale a mais nova.
  // Aplicadas da mais antiga para a mais nova, com o id (UUID v7, ordenável) desempatando: o resultado não depende da
  // ordem em que o banco devolve as linhas
  const active = input.overrides
    .filter((o) => !o.revokedAt && o.validUntil.getTime() > now.getTime())
    .sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const knownModules = new Set(Object.keys(catalog.modules));
  const tiersDef = tierIndex(catalog);
  const knownFeatures = new Map<string, ApiModule>();
  for (const [m, def] of Object.entries(catalog.modules))
    for (const f of Object.keys(def.features)) knownFeatures.set(f, m as ApiModule);

  // módulos: os do tenant, mais os concedidos, menos os retirados
  const modules = new Set<ApiModule>(tenant.modules.filter((m) => knownModules.has(m)));
  for (const o of active) {
    if (o.kind !== 'module_grant' && o.kind !== 'module_revoke') continue;
    if (!knownModules.has(o.key)) {
      warnings.push(`exceção ${o.kind} com módulo desconhecido: ${o.key}`);
      continue;
    }
    if (o.kind === 'module_grant') modules.add(o.key as ApiModule);
    else modules.delete(o.key as ApiModule);
  }
  const moduleList = STATES_WITHOUT_ACCESS.includes(state) ? [] : [...modules].sort();

  for (const m of moduleList)
    if (!meetsRequirement(catalog.modules[m].requires, tenant.plan, moduleList))
      warnings.push(`módulo ${m} sem o que o catálogo exige (plano ${tenant.plan})`);

  // features: as do catálogo para o plano e os módulos, mais as concedidas (de módulo que o tenant tem)
  const features = new Set(featuresFor(catalog, tenant.plan, moduleList));
  for (const o of active) {
    if (o.kind !== 'feature_grant') continue;
    const owner = knownFeatures.get(o.key);
    if (!owner) warnings.push(`exceção feature_grant com feature desconhecida: ${o.key}`);
    else if (moduleList.includes(owner)) features.add(o.key);
  }

  // add-ons: soma das unidades
  const addons: Record<string, number> = {};
  for (const o of active) {
    if (o.kind !== 'addon') continue;
    const def = catalog.addons[o.key];
    if (!def) warnings.push(`exceção addon com add-on desconhecido: ${o.key}`);
    else if (moduleList.includes(def.module)) addons[o.key] = (addons[o.key] ?? 0) + (o.value ?? 0);
  }

  // faixas: padrão do módulo → plano → escolha do tenant → add-on recorrente soma → exceção fixa
  const tiers: Record<string, number> = {};
  for (const m of moduleList)
    for (const [k, def] of Object.entries(catalog.modules[m].tiers)) tiers[k] = def.default;
  for (const [k, v] of Object.entries(catalog.plans[tenant.plan].tiers)) if (k in tiers) tiers[k] = v;
  for (const l of input.moduleLimits) {
    const def = tiersDef.get(l.key);
    if (!def) warnings.push(`faixa do tenant desconhecida no catálogo: ${l.key}`);
    else if (l.key in tiers) {
      if (isValidTierValue(def.def, l.value)) tiers[l.key] = l.value;
      else warnings.push(`faixa do tenant fora do aceito: ${l.key} = ${l.value}`);
    }
  }
  for (const [key, n] of Object.entries(addons)) {
    const def = catalog.addons[key]!;
    if (def.billing === 'recurring' && def.tier in tiers) tiers[def.tier] = (tiers[def.tier] ?? 0) + n;
  }
  for (const o of active) {
    if (o.kind !== 'tier') continue;
    if (!tiersDef.has(o.key)) warnings.push(`exceção tier com faixa desconhecida: ${o.key}`);
    else if (o.key in tiers) tiers[o.key] = o.value ?? tiers[o.key]!;
  }

  const capTier =
    tenant.capacityTier && catalog.capacity.tiers[tenant.capacityTier]
      ? tenant.capacityTier
      : catalog.capacity.default;
  const cap = catalog.capacity.tiers[capTier];

  const body: Omit<Entitlements, 'version'> = {
    tenantId: tenant.id,
    isGalaxie: opts.galaxieTenantIds?.includes(tenant.id) ?? false,
    state,
    plan: tenant.plan,
    modules: moduleList,
    features: [...features].sort(),
    tiers: Object.fromEntries(Object.entries(tiers).sort(([a], [b]) => a.localeCompare(b))),
    addons: Object.fromEntries(Object.entries(addons).sort(([a], [b]) => a.localeCompare(b))),
    capacity: {
      tier: capTier,
      viewsPerMonth: cap.viewsPerMonth,
      peakConcurrent: cap.peakConcurrent,
      chatWriters: cap.chatWriters,
    },
    markets: [...tenant.markets],
    sports: [...tenant.sports],
    limits: { rateLimitPerMinute: tenant.rateLimitPerMinute, dailyRequestQuota: tenant.dailyRequestQuota },
    credits: input.wallet ? { available: input.wallet.available, status: input.wallet.status } : null,
    trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
    catalogVersion: tenant.catalogVersion ?? catalog.version,
    warnings,
  };
  const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { ...body, version };
}

/** O tenant pode usar o módulo agora? */
export function hasModule(e: Pick<Entitlements, 'modules'>, m: ApiModule): boolean {
  return e.modules.includes(m);
}

/** A feature está ligada agora? */
export function hasFeature(e: Pick<Entitlements, 'features'>, f: string): boolean {
  return e.features.includes(f);
}
