import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { API_MODULES, API_PLANS, type ApiModule, type ApiPlan } from '@galaxie/db';
import { defaultCatalogDir } from './paths.js';
import { parsePlans, PlansConfigError, type PlanCatalog } from './plans.js';
import {
  AddonsFile,
  CAPACITY_TIERS,
  CapacityFile,
  ModulesFile,
  type AddonDef,
  type CapacityDef,
  type CapacityTier,
  type ModuleDef,
  type Requirement,
} from './schema.js';

/** Arquivos do catálogo, na ordem em que entram no hash da versão. */
export const CATALOG_FILES = ['modules.yaml', 'plans.yaml', 'capacity.yaml', 'addons.yaml'] as const;
export type CatalogFile = (typeof CATALOG_FILES)[number];

export type Catalog = {
  modules: Record<ApiModule, ModuleDef>;
  plans: PlanCatalog;
  capacity: { default: CapacityTier; tiers: Record<CapacityTier, CapacityDef> };
  addons: Record<string, AddonDef>;
  /** `sha256:<12 hex>` do conteúdo dos arquivos: o tenant guarda a versão que assinou. */
  version: string;
};

export class CatalogConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`config/catalog inválido:\n- ${problems.join('\n- ')}`);
    this.name = 'CatalogConfigError';
  }
}

function zodProblems(file: string, issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((i) => `${file} ${i.path.map(String).join('.') || '(raiz)'}: ${i.message}`);
}

/** Versão do catálogo: hash do conteúdo dos arquivos (fim de linha normalizado, para Windows e Linux darem o mesmo). */
export function catalogVersion(texts: Record<CatalogFile, string>): string {
  const h = createHash('sha256');
  for (const f of CATALOG_FILES) h.update(`${f}\n${texts[f].replace(/\r\n/g, '\n')}\n`);
  return `sha256:${h.digest('hex').slice(0, 12)}`;
}

/** Valida os arquivos já lidos e confere a consistência entre eles. Lança `CatalogConfigError` com todos os problemas. */
export function parseCatalog(texts: Record<CatalogFile, string>): Catalog {
  const problems: string[] = [];
  const raw = (f: CatalogFile): unknown => {
    try {
      return parse(texts[f]);
    } catch (err) {
      problems.push(`${f}: YAML inválido (${(err as Error).message})`);
      return undefined;
    }
  };

  const modulesR = ModulesFile.safeParse(raw('modules.yaml'));
  if (!modulesR.success) problems.push(...zodProblems('modules.yaml', modulesR.error.issues));
  let plans: PlanCatalog | undefined;
  try {
    plans = parsePlans(raw('plans.yaml'));
  } catch (err) {
    if (!(err instanceof PlansConfigError)) throw err;
    problems.push(err.message);
  }
  const capacityR = CapacityFile.safeParse(raw('capacity.yaml'));
  if (!capacityR.success) problems.push(...zodProblems('capacity.yaml', capacityR.error.issues));
  const addonsR = AddonsFile.safeParse(raw('addons.yaml'));
  if (!addonsR.success) problems.push(...zodProblems('addons.yaml', addonsR.error.issues));
  if (problems.length || !modulesR.success || !plans || !capacityR.success || !addonsR.success)
    throw new CatalogConfigError(problems);

  const missingModules = API_MODULES.filter((m) => !modulesR.data.modules[m]);
  if (missingModules.length) problems.push(`modules.yaml sem o(s) módulo(s): ${missingModules.join(', ')}`);
  const missingCapacity = CAPACITY_TIERS.filter((c) => !capacityR.data.tiers[c]);
  if (missingCapacity.length) problems.push(`capacity.yaml sem a(s) faixa(s): ${missingCapacity.join(', ')}`);
  if (problems.length) throw new CatalogConfigError(problems);

  const catalog: Catalog = {
    modules: modulesR.data.modules as Record<ApiModule, ModuleDef>,
    plans,
    capacity: {
      default: capacityR.data.default,
      tiers: capacityR.data.tiers as Record<CapacityTier, CapacityDef>,
    },
    addons: addonsR.data.addons,
    version: catalogVersion(texts),
  };
  problems.push(...checkConsistency(catalog));
  if (problems.length) throw new CatalogConfigError(problems);
  return catalog;
}

/** Lê `config/catalog/*.yaml` (ou `CATALOG_DIR`) e valida. */
export function loadCatalog(dir = defaultCatalogDir()): Catalog {
  const texts = {} as Record<CatalogFile, string>;
  const problems: string[] = [];
  for (const f of CATALOG_FILES) {
    try {
      texts[f] = readFileSync(join(dir, f), 'utf8');
    } catch (err) {
      problems.push(`não foi possível ler ${join(dir, f)}: ${(err as Error).message}`);
    }
  }
  if (problems.length) throw new CatalogConfigError(problems);
  return parseCatalog(texts);
}

/** Todas as faixas definidas pelos módulos, com o módulo dono. */
export function tierIndex(
  catalog: Pick<Catalog, 'modules'>,
): Map<string, { module: ApiModule; def: ModuleDef['tiers'][string] }> {
  const idx = new Map<string, { module: ApiModule; def: ModuleDef['tiers'][string] }>();
  for (const m of API_MODULES)
    for (const [k, def] of Object.entries(catalog.modules[m].tiers)) idx.set(k, { module: m, def });
  return idx;
}

/** Valor aceito para a faixa? (dentro de min e max e, quando há valores fixos, um deles). */
export function isValidTierValue(def: ModuleDef['tiers'][string], value: number): boolean {
  if (!Number.isInteger(value) || value < def.min || value > def.max) return false;
  return def.values ? def.values.includes(value) : true;
}

function requirementModules(r: Requirement | undefined): ApiModule[] {
  return [...(r?.modules ?? []), ...(r?.anyModule ?? [])];
}

/** Regras entre os arquivos: o que o Zod sozinho não enxerga. Devolve a lista de problemas (vazia = ok). */
export function checkConsistency(catalog: Omit<Catalog, 'version'>): string[] {
  const problems: string[] = [];
  const featureOwner = new Map<string, ApiModule>();
  const tiers = tierIndex(catalog);

  for (const m of API_MODULES) {
    const def = catalog.modules[m];
    const features = Object.entries(def.features);
    if (!features.length) problems.push(`módulo ${m} sem feature`);
    if (requirementModules(def.requires).includes(m)) problems.push(`módulo ${m} exige a si mesmo`);
    if (def.kind === 'data' && def.requires?.plans)
      problems.push(`módulo de dados ${m} não pode exigir plano: ele entra pelo plano`);

    for (const [key, t] of Object.entries(def.tiers)) {
      if (!key.startsWith(`${m}.`)) problems.push(`faixa ${key} fora do prefixo do módulo ${m}`);
      if (t.min > t.max) problems.push(`faixa ${key}: min maior que max`);
      if (t.values?.some((v) => v < t.min || v > t.max))
        problems.push(`faixa ${key}: valor fixo fora de min e max`);
      if (!isValidTierValue(t, t.default))
        problems.push(`faixa ${key}: padrão ${t.default} não é um valor aceito`);
    }

    for (const [key, f] of features) {
      const other = featureOwner.get(key);
      if (other) problems.push(`feature ${key} repetida em ${other} e ${m}`);
      featureOwner.set(key, m);
      if (requirementModules(f.requires).includes(m))
        problems.push(`feature ${key} exige o próprio módulo ${m}`);
      for (const p of f.plans ?? [])
        if (!catalog.plans[p].modules.includes(m))
          problems.push(`feature ${key} limitada ao plano ${p}, que não inclui o módulo ${m}`);
    }
  }

  // dependência circular entre módulos (pelas exigências do módulo e das features dele)
  const edges = new Map<ApiModule, ApiModule[]>();
  for (const m of API_MODULES) {
    const def = catalog.modules[m];
    edges.set(m, [
      ...requirementModules(def.requires),
      ...Object.values(def.features).flatMap((f) => requirementModules(f.requires)),
    ]);
  }
  const state = new Map<ApiModule, 'visiting' | 'done'>();
  const visit = (m: ApiModule, path: ApiModule[]): void => {
    if (state.get(m) === 'done') return;
    if (state.get(m) === 'visiting') {
      problems.push(`dependência circular: ${[...path.slice(path.indexOf(m)), m].join(' → ')}`);
      return;
    }
    state.set(m, 'visiting');
    for (const n of edges.get(m) ?? []) visit(n, [...path, m]);
    state.set(m, 'done');
  };
  for (const m of API_MODULES) visit(m, []);

  for (const p of API_PLANS) {
    const plan = catalog.plans[p];
    for (const m of plan.modules) {
      if (catalog.modules[m].kind !== 'data')
        problems.push(`plano ${p} inclui o módulo de engajamento ${m}: engajamento é contratado à parte`);
    }
    for (const [key, value] of Object.entries(plan.tiers)) {
      const t = tiers.get(key);
      if (!t) problems.push(`plano ${p}: faixa ${key} não existe em modules.yaml`);
      else if (!plan.modules.includes(t.module))
        problems.push(`plano ${p}: faixa ${key} de módulo fora do plano`);
      else if (!isValidTierValue(t.def, value))
        problems.push(`plano ${p}: faixa ${key} = ${value} fora do aceito`);
    }
  }

  for (const [key, a] of Object.entries(catalog.addons)) {
    const t = tiers.get(a.tier);
    if (!t) problems.push(`add-on ${key}: faixa ${a.tier} não existe em modules.yaml`);
    else if (t.module !== a.module)
      problems.push(`add-on ${key}: faixa ${a.tier} não é do módulo ${a.module}`);
  }

  if (!catalog.capacity.tiers[catalog.capacity.default]) problems.push(`capacity.yaml: padrão sem faixa`);
  let prev: CapacityDef | undefined;
  for (const c of CAPACITY_TIERS) {
    const cur = catalog.capacity.tiers[c];
    if (prev && cur) {
      for (const k of ['viewsPerMonth', 'peakConcurrent', 'chatWriters'] as const) {
        const a = prev[k];
        const b = cur[k];
        if (a === null && b !== null)
          problems.push(`capacity.yaml: ${c}.${k} tem teto depois de uma faixa sem teto`);
        if (a !== null && b !== null && b <= a)
          problems.push(`capacity.yaml: ${c}.${k} não cresce em relação à faixa anterior`);
      }
    }
    prev = cur;
  }
  return problems;
}

/** A exigência está cumprida por este plano e estes módulos? */
export function meetsRequirement(
  r: Requirement | undefined,
  plan: ApiPlan,
  modules: readonly ApiModule[],
): boolean {
  if (!r) return true;
  if (r.plans && !r.plans.includes(plan)) return false;
  if (r.modules && !r.modules.every((m) => modules.includes(m))) return false;
  if (r.anyModule && !r.anyModule.some((m) => modules.includes(m))) return false;
  return true;
}

/** Features ligadas por um plano e uma lista de módulos (em ordem alfabética). */
export function featuresFor(
  catalog: Pick<Catalog, 'modules'>,
  plan: ApiPlan,
  modules: readonly ApiModule[],
): string[] {
  const out: string[] = [];
  for (const m of modules) {
    for (const [key, f] of Object.entries(catalog.modules[m].features)) {
      if (f.plans && !f.plans.includes(plan)) continue;
      if (!meetsRequirement(f.requires, plan, modules)) continue;
      out.push(key);
    }
  }
  return out.sort();
}
