/**
 * Regras puras da página Ajustes → Dados → Módulos por esporte: o rascunho dos switches de cada módulo por tier, os
 * textos que vão para o servidor (MODULES_<API> para os módulos dos jobs, MIRROR_PERIODS_<API> para os do espelho) e
 * o custo de cada módulo (medido no ledger dos últimos dias e estimado pelo inventário do espelho). Sem React nem
 * servidor, para os testes.
 */
import {
  MODULE_TIERS,
  applyModuleToMirrorPeriods,
  defaultPeriods,
  formatMirrorPeriods,
  formatModules,
  mirrorConfig,
  mirrorItem,
  mirrorItems,
  mirrorPeriodsKey,
  moduleColumn,
  moduleConfig,
  moduleDefs,
  modulesKey,
  tierColumn,
  type MirrorInventory,
  type MirrorPeriod,
  type ModuleDef,
  type ModuleTier,
} from '@galaxie/runtime-config';

import type { ModulesSnapshot } from '@/lib/ops/types';

/** Estado dos switches de cada módulo (um por tier, ou um só). */
export type ModuleDraft = Record<string, boolean[]>;

/** Leitor das duas flags da API (os valores efetivos do painel). */
const reader = (api: string, modulesValue: string | null, mirrorValue: string | null) => (key: string) =>
  key === modulesKey(api) ? modulesValue : key === mirrorPeriodsKey(api) ? mirrorValue : null;

/** Rascunho a partir dos valores efetivos das flags (painel, .env ou padrão). */
export function initialModuleDraft(
  api: string,
  modulesValue: string | null,
  mirrorValue: string | null,
): ModuleDraft {
  const get = reader(api, modulesValue, mirrorValue);
  const cfg = moduleConfig(get, { mirror: mirrorConfig(get) }).api(api);
  const out: ModuleDraft = {};
  for (const def of moduleDefs(api)) out[def.id] = cfg.states(def.id);
  return out;
}

/** Períodos efetivos do espelho da API (padrão com a sobrescrita por cima), por item. */
export function mirrorPeriodsOf(api: string, mirrorValue: string | null): Map<string, MirrorPeriod[]> {
  const cfg = mirrorConfig((key) => (key === mirrorPeriodsKey(api) ? mirrorValue : null)).api(api);
  return new Map(mirrorItems(api).map((def) => [def.id, cfg.periods(def.id)]));
}

export interface ModuleDraftTexts {
  /** Texto canônico de MODULES_<API> (vazio = tudo no padrão). */
  modules: string;
  /** Texto canônico de MIRROR_PERIODS_<API> com os módulos do espelho aplicados. */
  mirror: string;
  /** Períodos do espelho resultantes (para a estimativa por tier). */
  periods: Map<string, MirrorPeriod[]>;
}

/** O que o rascunho grava: a flag dos jobs e a do espelho, cada uma só com o que difere do padrão. */
export function moduleDraftTexts(
  api: string,
  draft: ModuleDraft,
  mirrorValue: string | null,
): ModuleDraftTexts {
  const jobStates = new Map<string, boolean[]>();
  let periods = mirrorPeriodsOf(api, mirrorValue);
  for (const def of moduleDefs(api)) {
    const states = draft[def.id] ?? def.defaults;
    if (def.kind === 'job') jobStates.set(def.id, [...states]);
    else if (def.kind === 'mirror') periods = applyModuleToMirrorPeriods(api, def, states, periods);
  }
  return { modules: formatModules(api, jobStates), mirror: formatMirrorPeriods(api, periods), periods };
}

/** Nome do job como o ledger o vê (`sync:daily`) e como o catálogo o nomeia (`sync-daily`): o mesmo. */
const jobKey = (job: string) => job.replace(/:/g, '-');

/**
 * Chamadas por dia medidas de um módulo na janela do ledger: pelos passos do job (`steps`), quando o endpoint não
 * basta, ou pelo ledger por (API, endpoint, job). `null` nos módulos sem cota (agentes de IA) ou sem janela.
 */
export function measuredCallsPerDay(api: string, def: ModuleDef, snapshot: ModulesSnapshot): number | null {
  if (def.ai || !snapshot.windowDays) return null;
  const jobs = new Set(def.jobs.map(jobKey));
  let calls = 0;
  if (def.steps?.length) {
    const steps = new Set(def.steps);
    for (const row of snapshot.steps)
      if (row.api === api && jobs.has(jobKey(row.job)) && steps.has(row.step)) calls += row.calls;
  } else {
    const endpoints = new Set(def.endpoints);
    for (const row of snapshot.costs)
      if (row.api === api && endpoints.has(row.endpoint) && jobs.has(jobKey(row.job))) calls += row.calls;
  }
  return calls / snapshot.windowDays;
}

/**
 * Estimativa de chamadas por dia de um módulo do espelho num tier (ou no total, sem tier), pelo inventário da
 * última execução e os períodos do rascunho; `null` sem inventário ou fora do espelho.
 */
export function estimatedCallsPerDay(
  api: string,
  def: ModuleDef,
  periods: ReadonlyMap<string, readonly MirrorPeriod[]>,
  inventory: MirrorInventory | null,
  tier?: ModuleTier,
): number | null {
  if (def.kind !== 'mirror' || !inventory) return null;
  let total = 0;
  for (const item of def.items) {
    const itemDef = mirrorItem(api, item)!;
    const counts = inventory.items[item] ?? [];
    const p = periods.get(item) ?? defaultPeriods(itemDef);
    const col = tier === undefined ? null : tierColumn(itemDef, tier);
    counts.forEach((n, i) => {
      if (col !== null && i !== col) return;
      const days = p[i];
      if (days) total += n / days;
    });
  }
  return total;
}

/** Módulos de uma linha do painel: sem tier (`null`) ou os que têm switch naquele tier. */
export function modulesOfRow(api: string, tier: ModuleTier | null): ModuleDef[] {
  return moduleDefs(api).filter((d) => (tier === null ? !d.tiers.length : d.tiers.includes(tier)));
}

/** Módulos com tiers que não chegam a este tier (o job não cobre): a nota "sem switch". */
export function modulesNotCovering(api: string, tier: ModuleTier): ModuleDef[] {
  return moduleDefs(api).filter((d) => d.tiers.length > 0 && !d.tiers.includes(tier));
}

/** Coluna do rascunho de um módulo num tier (0 nos módulos sem tier). */
export const draftColumn = (def: ModuleDef, tier: ModuleTier | null): number =>
  tier === null ? 0 : Math.max(0, moduleColumn(def, tier));

/** Quantos switches da linha estão ligados, e quantos ela tem (módulos fixos contam como ligados). */
export function rowSummary(
  api: string,
  draft: ModuleDraft,
  tier: ModuleTier | null,
): { on: number; total: number } {
  const defs = modulesOfRow(api, tier);
  const on = defs.filter((d) => (draft[d.id] ?? d.defaults)[draftColumn(d, tier)]).length;
  return { on, total: defs.length };
}

/** As linhas de tier do painel, na ordem: sem tier, 1, 2, 3+. */
export const MODULE_ROWS: readonly (ModuleTier | null)[] = [null, ...MODULE_TIERS];
