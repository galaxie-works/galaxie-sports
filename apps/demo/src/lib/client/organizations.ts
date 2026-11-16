/**
 * Organizações (`billing.organization`, #1136 F2) para Ajustes › Clientes › Organizações e marcas: a equipe Galaxie
 * vê quem assina e paga por cada marca e edita a faixa de capacidade, a revisão do cadastro e o cliente zero, sempre
 * com motivo em `billing.staff_action`. Só no servidor; as páginas chamam `requireStaff` antes. Nada de preço aqui.
 */
import { pool } from '@/lib/auth/db';

import { isUuid } from './tenants';

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

const isMissingTable = (err: unknown) => (err as { code?: string }).code === '42P01';

async function query(where: string, params: unknown[]): Promise<OrganizationRow[]> {
  try {
    const { rows } = await pool.query<{
      id: string;
      slug: string;
      name: string;
      country: string;
      currency: string;
      billing_entity: string;
      capacity_tier: CapacityTier;
      review_status: ReviewStatus;
      is_galaxie: boolean;
      created_at: Date;
      brands: OrganizationBrand[] | null;
      members: number;
    }>(
      `select o.id::text, o.slug, o.name, o.country, o.currency, o.billing_entity, o.capacity_tier, o.review_status,
              o.is_galaxie, o.created_at,
              (select json_agg(json_build_object('id', t.id::text, 'slug', t.slug, 'name', t.name,
                                                  'status', t.status::text, 'plan', t.plan) order by t.name, t.slug)
                 from api.tenant t where t.organization_id = o.id) as brands,
              (select count(*)::int from billing.organization_member m where m.organization_id = o.id) as members
         from billing.organization o
        ${where}
        order by o.is_galaxie desc, o.name, o.slug`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      country: r.country,
      currency: r.currency,
      billingEntity: r.billing_entity,
      capacityTier: r.capacity_tier,
      reviewStatus: r.review_status,
      isGalaxie: r.is_galaxie,
      createdAt: r.created_at.toISOString(),
      brands: r.brands ?? [],
      members: r.members,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export const listOrganizations = () => query('', []);

export async function getOrganization(id: string): Promise<OrganizationRow | null> {
  if (!isUuid(id)) return null;
  return (await query('where o.id = $1', [id]))[0] ?? null;
}

/**
 * Grava a mudança e a ação da equipe (`organization.update`, com o antes e o depois) na mesma transação. Sem mudança
 * de fato, não grava nada e devolve false.
 */
export async function updateOrganization(input: {
  id: string;
  patch: OrganizationPatch;
  actor: string;
  reason: string;
}): Promise<boolean> {
  const before = await getOrganization(input.id);
  if (!before) return false;
  const after = {
    capacityTier: input.patch.capacityTier ?? before.capacityTier,
    reviewStatus: input.patch.reviewStatus ?? before.reviewStatus,
    isGalaxie: input.patch.isGalaxie ?? before.isGalaxie,
  };
  const changed = (['capacityTier', 'reviewStatus', 'isGalaxie'] as const).filter(
    (k) => after[k] !== before[k],
  );
  if (!changed.length) return false;
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `update billing.organization
          set capacity_tier = $2, review_status = $3, is_galaxie = $4, updated_at = now()
        where id = $1`,
      [input.id, after.capacityTier, after.reviewStatus, after.isGalaxie],
    );
    await c.query(
      `insert into billing.staff_action (organization_id, actor, action, reason, payload)
       values ($1, $2, 'organization.update', $3, $4)`,
      [
        input.id,
        input.actor,
        input.reason,
        {
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
        },
      ],
    );
    await c.query('commit');
    return true;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
