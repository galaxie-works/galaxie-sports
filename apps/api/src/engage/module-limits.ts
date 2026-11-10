import {
  ENGAGE_MODULES,
  isValidModuleLimit,
  MODULE_LIMIT_KEYS,
  MODULE_LIMITS,
  tenantModuleLimit,
  type ApiModule,
  type Database,
  type EngageModule,
  type ModuleLimitKey,
} from '@galaxie/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** Faixa efetiva de um módulo no tenant: o valor gravado ou o padrão da Galaxie. */
export interface ModuleLimitView {
  key: ModuleLimitKey;
  module: EngageModule;
  value: number;
  /** true = valor próprio do tenant; false = padrão. */
  custom: boolean;
  default: number;
  min: number;
  max: number;
  tiers: readonly number[] | null;
}

/** Faixas dos módulos de engajamento que o tenant tem (módulo desligado = faixa fora da lista). */
export async function moduleLimitsOf(
  db: Database,
  tenantId: string,
  modules: readonly ApiModule[],
): Promise<ModuleLimitView[]> {
  const rows = await db
    .select({ key: tenantModuleLimit.key, value: tenantModuleLimit.value })
    .from(tenantModuleLimit)
    .where(eq(tenantModuleLimit.tenantId, tenantId));
  const saved = new Map(rows.map((r) => [r.key, r.value]));
  return MODULE_LIMIT_KEYS.filter((key) => modules.includes(MODULE_LIMITS[key].module)).map((key) => {
    const def = MODULE_LIMITS[key];
    const value = saved.get(key);
    const ok = value !== undefined && isValidModuleLimit(key, value);
    return {
      key,
      module: def.module,
      value: ok ? value : def.default,
      custom: ok,
      default: def.default,
      min: def.min,
      max: def.max,
      tiers: def.tiers,
    };
  });
}

export class ModuleLimitError extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = 'ModuleLimitError';
  }
}

/**
 * Grava faixas do tenant (`null` volta ao padrão). Recusa chave desconhecida, valor fora do teto ou fora das faixas
 * fixas: o servidor nunca aceita valor acima do teto da Galaxie.
 */
export async function setModuleLimits(
  db: Database,
  tenantId: string,
  limits: Record<string, number | null>,
  by: string,
): Promise<void> {
  const entries = Object.entries(limits);
  for (const [key, value] of entries) {
    if (!(key in MODULE_LIMITS)) throw new ModuleLimitError(key, `faixa desconhecida: ${key}`);
    if (value !== null && !isValidModuleLimit(key as ModuleLimitKey, value)) {
      const def = MODULE_LIMITS[key as ModuleLimitKey];
      throw new ModuleLimitError(
        key,
        def.tiers
          ? `valor fora das faixas (${def.tiers.join(', ')})`
          : `valor fora do teto (${def.min} a ${def.max})`,
      );
    }
  }
  await db.transaction(async (tx) => {
    const reset = entries.filter(([, v]) => v === null).map(([k]) => k as ModuleLimitKey);
    if (reset.length)
      await tx
        .delete(tenantModuleLimit)
        .where(and(eq(tenantModuleLimit.tenantId, tenantId), inArray(tenantModuleLimit.key, reset)));
    const set = entries.filter(([, v]) => v !== null) as [ModuleLimitKey, number][];
    if (set.length)
      await tx
        .insert(tenantModuleLimit)
        .values(set.map(([key, value]) => ({ tenantId, key, value, updatedBy: by })))
        .onConflictDoUpdate({
          target: [tenantModuleLimit.tenantId, tenantModuleLimit.key],
          set: { value: tenantModuleLimitExcluded.value, updatedBy: tenantModuleLimitExcluded.updatedBy },
        });
  });
}

const tenantModuleLimitExcluded = {
  value: sql`excluded.value`,
  updatedBy: sql`excluded.updated_by`,
};

/** Os módulos de engajamento de uma lista de módulos do tenant. */
export const engageModulesOf = (modules: readonly ApiModule[]): EngageModule[] =>
  ENGAGE_MODULES.filter((m) => modules.includes(m));
