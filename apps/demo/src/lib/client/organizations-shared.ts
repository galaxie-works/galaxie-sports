/**
 * Parte pura das organizações (`billing.organization`, #1136 F2): faixas, estados de revisão, estados da marca e
 * tipos das linhas. Sem banco, para os componentes de cliente de Ajustes importarem sem puxar o Postgres para o
 * navegador; as consultas e escritas vivem em `organizations.ts`, só no servidor.
 */
import { CAPACITY_TIERS, type CapacityTier } from '@galaxie/db/engage-modules';
import type { TenantState } from '@galaxie/db/schema';

// a lista é a do @galaxie/db (arquivo sem banco), a mesma do catálogo e do check constraint (#1446)
export { CAPACITY_TIERS, type CapacityTier };
export const REVIEW_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Os 9 estados da marca (`api.tenant.state`, F3), na ordem do diagrama do doc 02; a lista canônica é a do `@galaxie/db`. */
export const TENANT_STATES = [
  'draft',
  'pending_review',
  'rejected',
  'trial',
  'trial_expired',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const satisfies readonly TenantState[];
export type { TenantState };

/**
 * Ações da equipe sobre o estado de uma marca (F3, decisão 7). `from` é só a oferta da tela: quem valida de fato é
 * `canTransition` (`@galaxie/billing`), no servidor. `extend_trial` não muda o estado, só o prazo.
 */
export const BRAND_STATE_ACTIONS = {
  approve: { from: ['pending_review'], to: 'trial' },
  reject: { from: ['pending_review'], to: 'rejected' },
  suspend: { from: ['trial', 'active', 'past_due'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'active' },
  cancel: { from: ['trial', 'trial_expired', 'active', 'past_due', 'suspended'], to: 'cancelled' },
  extend_trial: { from: ['trial'], to: 'trial' },
} as const satisfies Record<string, { from: readonly TenantState[]; to: TenantState }>;
export type BrandStateAction = keyof typeof BRAND_STATE_ACTIONS;
export const BRAND_STATE_ACTION_NAMES = Object.keys(BRAND_STATE_ACTIONS) as BrandStateAction[];

/** As ações que a tela oferece para uma marca no estado dado, na ordem fixa. */
export const brandActionsFor = (state: TenantState): BrandStateAction[] =>
  BRAND_STATE_ACTION_NAMES.filter((a) =>
    (BRAND_STATE_ACTIONS[a].from as readonly TenantState[]).includes(state),
  );

export interface OrganizationBrand {
  id: string;
  slug: string;
  name: string;
  /** Espelho de `state` (até o PR `contrair`); a tela mostra `state`. */
  status: 'active' | 'suspended';
  plan: string;
  state: TenantState;
  /** ISO 8601. */
  stateSince: string;
  /** Prazo do estado `trial` (ISO 8601); null sem prazo. */
  trialEndsAt: string | null;
}

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  country: string;
  currency: string;
  billingEntity: string;
  capacityTier: CapacityTier;
  reviewStatus: ReviewStatus;
  isGalaxie: boolean;
  createdAt: string;
  brands: OrganizationBrand[];
  members: number;
}

/** Campos que a equipe edita na organização. */
export interface OrganizationPatch {
  capacityTier?: CapacityTier;
  reviewStatus?: ReviewStatus;
  isGalaxie?: boolean;
}
