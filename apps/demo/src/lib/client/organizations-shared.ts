/**
 * Parte pura das organizações (`billing.organization`, #1136 F2): faixas, estados de revisão e tipos das linhas. Sem
 * banco, para os componentes de cliente de Ajustes importarem sem puxar o Postgres para o navegador; as consultas e
 * escritas vivem em `organizations.ts`, só no servidor.
 */
export const CAPACITY_TIERS = ['C1', 'C2', 'C3', 'C4'] as const;
export type CapacityTier = (typeof CAPACITY_TIERS)[number];
export const REVIEW_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface OrganizationBrand {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  plan: string;
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
