import { API_PLANS, type ApiModule, type ApiPlan } from '@galaxie/db/schema';
import { meetsRequirement, type Catalog } from '../catalog/catalog.js';
import type { Entitlements } from '../entitlements/resolve.js';
import { STATES_WITHOUT_ACCESS } from '../tenant-state/state.js';

/**
 * A loja de features (plataforma comercial, #1137): cada módulo do catálogo cruzado com os direitos do tenant. É a
 * leitura que a tela Planos e módulos mostra; o teste por módulo entra com a F3 (decisão 9) e o checkout com a F4.
 */
export const STORE_STATES = [
  /** O módulo está nos direitos do tenant. */
  'included',
  /** Está nos direitos em teste: a conta em `trial` (todos os módulos) ou o módulo em teste pela loja (`trialEndsAt`). */
  'trial',
  /** Vendável e o tenant pode contratar como está (plano e dependências atendidos). */
  'available',
  /** Exige um plano acima do atual (`plans`: os que liberam). */
  'needs_plan',
  /** Só por contrato com a Galaxie. */
  'contract',
  /** No catálogo, ainda não vendável. */
  'soon',
  /** Fechado até decisão do dono. */
  'closed',
  /** O tenant está sem acesso (suspenso, cancelado, teste vencido): nada se contrata pela loja até regularizar. */
  'blocked',
] as const;
export type StoreState = (typeof STORE_STATES)[number];

export type StoreItem = {
  module: ApiModule;
  kind: 'data' | 'engage';
  name: string;
  state: StoreState;
  /** `needs_plan`: planos que liberam o módulo, do menor para o maior. */
  plans?: ApiPlan[];
  /**
   * Dias de teste do módulo (para "Ativar teste"); null = sem teste, ou o teste já foi usado nesta organização
   * (`trialsUsed`): a loja não oferece de novo.
   */
  trialDays: number | null;
  /** `trial`: fim do teste (ISO 8601): o do módulo pela loja ou, com a conta em `trial`, o `trial_ends_at` da conta. */
  trialEndsAt?: string;
};

/** O que a loja lê dos direitos; `moduleTrials` e `trialEndsAt` são opcionais para quem só tem o essencial. */
export type StoreEntitlements = Pick<Entitlements, 'plan' | 'modules' | 'state'> &
  Partial<Pick<Entitlements, 'moduleTrials' | 'trialEndsAt'>>;

export type StoreOptions = {
  /** Módulos cujo teste a organização já usou (`billing.module_trial`, em curso ou vencido): sem "Ativar teste". */
  trialsUsed?: readonly (ApiModule | string)[];
};

/** Planos acima do atual, vendáveis pela loja, que passam no filtro; na ordem do catálogo (do menor para o maior). */
function upgradePlans(catalog: Catalog, current: ApiPlan, keep: (p: ApiPlan) => boolean): ApiPlan[] {
  const from = API_PLANS.indexOf(current);
  return API_PLANS.filter((p, i) => i > from && catalog.plans[p].selfService && keep(p));
}

/** Um cartão por módulo do catálogo, na ordem do catálogo (dados primeiro, depois engajamento). */
export function storeView(catalog: Catalog, ent: StoreEntitlements, opts: StoreOptions = {}): StoreItem[] {
  const out: StoreItem[] = [];
  const blocked = STATES_WITHOUT_ACCESS.includes(ent.state);
  const used = new Set(opts.trialsUsed ?? []);
  for (const [m, def] of Object.entries(catalog.modules) as [ApiModule, Catalog['modules'][ApiModule]][]) {
    const base = {
      module: m,
      kind: def.kind,
      name: def.name,
      trialDays: used.has(m) ? null : def.trialDays,
    };
    if (blocked) {
      out.push({ ...base, state: 'blocked' });
      continue;
    }
    if (ent.modules.includes(m)) {
      // módulo em teste pela loja (prazo próprio) ou a conta inteira em teste (prazo da conta)
      const moduleTrialEnd = ent.moduleTrials?.[m];
      if (moduleTrialEnd) out.push({ ...base, state: 'trial', trialEndsAt: moduleTrialEnd });
      else if (ent.state === 'trial')
        out.push({ ...base, state: 'trial', ...(ent.trialEndsAt ? { trialEndsAt: ent.trialEndsAt } : {}) });
      else out.push({ ...base, state: 'included' });
      continue;
    }
    if (def.status === 'closed' || def.status === 'soon' || def.status === 'contract') {
      out.push({ ...base, state: def.status });
      continue;
    }
    if (def.kind === 'data') {
      // módulo de dados vem pelo plano: os planos acima do atual, vendáveis pela loja, que o incluem. Sem nenhum (o plano
      // atual já o inclui e ele foi retirado por acordo, ou só o Enterprise o tem): por contrato
      const plans = upgradePlans(catalog, ent.plan, (p) => catalog.plans[p].modules.includes(m));
      out.push(plans.length ? { ...base, state: 'needs_plan', plans } : { ...base, state: 'contract' });
      continue;
    }
    if (!meetsRequirement(def.requires, ent.plan, ent.modules)) {
      const required = def.requires?.plans;
      const planOk = !required || required.includes(ent.plan);
      if (planOk) {
        // falta outro módulo (dependência), não plano: contratável, junto com o que falta
        out.push({ ...base, state: 'available' });
        continue;
      }
      const plans = upgradePlans(catalog, ent.plan, (p) => required.includes(p));
      out.push(plans.length ? { ...base, state: 'needs_plan', plans } : { ...base, state: 'contract' });
      continue;
    }
    out.push({ ...base, state: 'available' });
  }
  return out;
}

/** O cartão aceita "Ativar teste de N dias"? (`available`, módulo com teste ainda não usado na organização.) */
export const canStartModuleTrial = (item: Pick<StoreItem, 'state' | 'trialDays'>): boolean =>
  item.state === 'available' && item.trialDays !== null;
