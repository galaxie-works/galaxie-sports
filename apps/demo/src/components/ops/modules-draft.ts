/**
 * Regras puras da página Ajustes → Dados → Módulos por esporte: o rascunho dos switches de cada módulo por tier, os
 * textos que vão para o servidor (MODULES_<API> para os módulos dos jobs, MIRROR_PERIODS_<API> para os do espelho) e
 * o custo de cada módulo (medido no ledger dos últimos dias e estimado pelo inventário do espelho). Sem React nem
 * servidor, para os testes.
 */
import {
  DAILY_CAP_MAX,
  MODULE_TIERS,
  applyModuleToMirrorPeriods,
  dailyCapDefault,
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
  type DailyCapKey,
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

const sameStates = (a: readonly boolean[], b: readonly boolean[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * O que o rascunho grava: a flag dos jobs e a do espelho, cada uma só com o que difere do padrão. No espelho, só os
 * módulos cujo switch mudou são aplicados aos itens: um módulo com vários endpoints (artilharia e cartões) conta como
 * ligado quando algum deles está ligado, e reaplicar esse estado agregado religaria um endpoint desligado um a um na
 * página do espelho.
 */
export function moduleDraftTexts(
  api: string,
  draft: ModuleDraft,
  mirrorValue: string | null,
): ModuleDraftTexts {
  const jobStates = new Map<string, boolean[]>();
  const current = initialModuleDraft(api, null, mirrorValue);
  let periods = mirrorPeriodsOf(api, mirrorValue);
  for (const def of moduleDefs(api)) {
    const states = draft[def.id] ?? def.defaults;
    if (def.kind === 'job') jobStates.set(def.id, [...states]);
    else if (def.kind === 'mirror') {
      const was = current[def.id] ?? def.defaults;
      if (sameStates(states, was)) continue;
      // só as colunas (tiers) que mudaram: os outros tiers dos itens ficam como estavam
      periods = applyModuleToMirrorPeriods(
        api,
        def,
        states,
        periods,
        states.map((v, i) => v !== was[i]),
      );
    }
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
  const defs = moduleDefs(api);
  const sameEndpoints = (a: ModuleDef, b: ModuleDef) =>
    a.endpoints.length > 0 &&
    a.endpoints.length === b.endpoints.length &&
    a.endpoints.every((e) => b.endpoints.includes(e));
  return defs.filter(
    (d) =>
      d.tiers.length > 0 &&
      !d.tiers.includes(tier) &&
      // o mesmo dado coberto por outro módulo neste tier (elencos: tier 1 no sync diário, 2+ no espelho) não é falta
      !defs.some((o) => o !== d && o.tiers.includes(tier) && sameEndpoints(o, d)),
  );
}

/** Chamadas por dia medidas dos módulos de uma API (sem os agentes de IA), na janela do ledger; `null` sem janela. */
export function measuredModulesPerDay(api: string, snapshot: ModulesSnapshot): number | null {
  if (!snapshot.windowDays) return null;
  let total = 0;
  for (const def of moduleDefs(api)) total += measuredCallsPerDay(api, def, snapshot) ?? 0;
  return total;
}

/** Chamadas por dia de toda a API no ledger (módulos, cargas e o resto), na janela; `null` sem janela. */
export function measuredApiPerDay(api: string, snapshot: ModulesSnapshot): number | null {
  if (!snapshot.windowDays) return null;
  return snapshot.costs.filter((c) => c.api === api).reduce((s, c) => s + c.calls, 0) / snapshot.windowDays;
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

// ── Tetos diários (DAILY_*) ─────────────────────────────────────────────────────────────────────────────────────

/** Plano pago da API (o free tem padrões próprios); plano desconhecido conta como pago, o caso da produção. */
export const isPaidPlan = (plan: string | null | undefined): boolean => plan !== 'free';

/** O switch "ilimitado" e o valor do slider (guardado também com o ilimitado ligado, para voltar a ele). */
export interface CapDraft {
  unlimited: boolean;
  value: number;
}

/** Rascunho a partir do valor efetivo da flag: vazio = padrão do plano; `unlimited`; ou o número. */
export function initialCapDraft(key: DailyCapKey, raw: string | null, paid: boolean): CapDraft {
  const fallback = dailyCapDefault(key, paid);
  const text = (raw ?? '').trim().toLowerCase();
  if (text === 'unlimited') return { unlimited: true, value: fallback };
  const n = Number(text);
  return { unlimited: false, value: text && Number.isInteger(n) && n >= 1 ? n : fallback };
}

/** Texto que vai para o servidor: `unlimited`, vazio quando é o padrão do plano, ou o número. */
export function capText(key: DailyCapKey, draft: CapDraft, paid: boolean): string {
  if (draft.unlimited) return 'unlimited';
  return draft.value === dailyCapDefault(key, paid) ? '' : String(Math.max(1, Math.trunc(draft.value)));
}

/** Teto do slider: a cota diária do plano da API (não adianta deixar ir a 150 mil com 7.500 disponíveis). */
export const capSliderMax = (dailyLimit: number | null | undefined): number =>
  Math.max(1, Math.min(DAILY_CAP_MAX, dailyLimit ?? DAILY_CAP_MAX));

/** Passo do slider proporcional ao teto. */
export const capStep = (max: number): number => (max <= 500 ? 1 : max <= 5000 ? 5 : max <= 20_000 ? 10 : 50);

/**
 * O rodízio tem um teto só para elencos, afastamentos e títulos: com afastamentos ou títulos ligados nos tiers 2 ou
 * 3 e o teto no padrão (ou abaixo), a vaga é dividida e o tier 1 passa a atrasar sem aviso.
 */
export function rotationOverloaded(draft: ModuleDraft, capValue: number, paid: boolean): boolean {
  if (!Number.isFinite(capValue) || capValue > dailyCapDefault('DAILY_ROTATION_CALLS', paid)) return false;
  return ['sidelined', 'trophies'].some((id) => (draft[id] ?? []).slice(1).some(Boolean));
}

/**
 * Módulo do espelho "parcial" num tier: parte dos endpoints ligada e parte desligada (alguém mexeu endpoint a endpoint
 * na página do espelho). O switch mostra ligado; o selo avisa.
 */
export function partialInTier(
  api: string,
  def: ModuleDef,
  periods: ReadonlyMap<string, readonly MirrorPeriod[]>,
  tier: ModuleTier | null,
): boolean {
  if (def.kind !== 'mirror' || def.items.length < 2) return false;
  const states = def.items.map((item) => {
    const itemDef = mirrorItem(api, item)!;
    const col = tier === null ? 0 : tierColumn(itemDef, tier);
    return (periods.get(item) ?? defaultPeriods(itemDef))[col] != null;
  });
  return states.some(Boolean) && states.some((v) => !v);
}
