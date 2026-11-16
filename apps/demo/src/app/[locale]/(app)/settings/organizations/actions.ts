'use server';

/**
 * Ações da equipe Galaxie em Ajustes › Organizações e marcas (#1136, F2): faixa de capacidade, revisão do cadastro e
 * cliente zero, sempre com motivo, registradas em `billing.staff_action` com o antes e o depois; e a criação
 * assistida de uma organização (PR c), pelo mesmo provisionamento do cadastro. Só a equipe (`requireStaff`: admin e
 * support). Nada de preço.
 */
import { revalidatePath } from 'next/cache';

import { requireStaff } from '@/lib/auth/admin';
import { pool } from '@/lib/auth/db';
import { sendInvite } from '@/lib/auth/invite';
import { auth } from '@/lib/auth/server';
import { builderDb } from '@/lib/builder/store';
import { catalog } from '@/lib/client/entitlements';
import { getOrganization, updateOrganization } from '@/lib/client/organizations';
import {
  CAPACITY_TIERS,
  REVIEW_STATUSES,
  type CapacityTier,
  type ReviewStatus,
} from '@/lib/client/organizations-shared';
import {
  issueMissingKeys,
  listOrganizationBrands,
  ProvisionError,
  provisionOrganization,
  type ProvisionedKeys,
} from '@/lib/client/provision';
import { normalizeStaffReason } from '@/lib/client/staff-reason';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { normalizeEmail } from '@/lib/signup/email-domain';
import {
  billingFor,
  defaultBrandOrigin,
  isSignupMarket,
  isValidSlug,
  normalizeName,
  PERSON_NAME_MAX,
} from '@/lib/signup/organization';
import { readSignupSettings } from '@/lib/signup/settings-db';
import { SITE_HOST } from '@/lib/site';

/** Chaves emitidas para uma marca, mostradas uma única vez à equipe. */
export interface IssuedBrandKeys {
  tenantId: string;
  brand: string;
  keys: ProvisionedKeys;
}

export interface OrganizationActionResult {
  ok: boolean;
  error?: string;
  /** Ao aprovar a revisão: as chaves que faltavam em cada marca (vazio = nada a emitir). */
  issued?: IssuedBrandKeys[];
}

const PATH = '/settings/organizations';

const hasKeys = (k: ProvisionedKeys) => Boolean(k.live || k.test || k.publishable);

async function recordStaffAction(input: {
  organizationId: string;
  tenantId?: string | null;
  actor: string;
  action: string;
  reason: string;
  payload: Record<string, unknown>;
}) {
  await pool.query(
    `insert into billing.staff_action (organization_id, tenant_id, actor, action, reason, payload)
     values ($1, $2, $3, $4, $5, $6)`,
    [input.organizationId, input.tenantId ?? null, input.actor, input.action, input.reason, input.payload],
  );
}

/**
 * Emite as chaves que faltam nas marcas da organização (ao aprovar a revisão do cadastro, PL2): o cliente em revisão
 * nasceu sem nada de produção. Cada emissão fica em `billing.staff_action` (só o prefixo, nunca o segredo).
 */
async function issueKeysForOrganization(
  organizationId: string,
  actor: string,
  reason: string,
): Promise<IssuedBrandKeys[]> {
  const db = builderDb();
  const issued: IssuedBrandKeys[] = [];
  for (const brand of await listOrganizationBrands(db, organizationId)) {
    const keys = await issueMissingKeys(db, {
      tenantId: brand.id,
      actor,
      defaultOrigin: defaultBrandOrigin(brand.slug, SITE_HOST),
    });
    if (!hasKeys(keys)) continue;
    issued.push({ tenantId: brand.id, brand: brand.name, keys });
    await recordStaffAction({
      organizationId,
      tenantId: brand.id,
      actor,
      action: 'organization.issue_keys',
      reason,
      payload: {
        issued: (['live', 'test', 'publishable'] as const).filter((k) => keys[k]),
      },
    });
  }
  return issued;
}

export async function updateOrganizationAction(input: {
  id: string;
  capacityTier?: string;
  reviewStatus?: string;
  isGalaxie?: boolean;
  reason: string;
}): Promise<OrganizationActionResult> {
  const me = await requireStaff();
  const e = getDictionary(await getRequestLocale()).platformStaff.errors;
  if (!isUuid(input?.id)) return { ok: false, error: e.notFound };
  const reason = normalizeStaffReason(input.reason);
  if (!reason) return { ok: false, error: e.reason };
  const patch: { capacityTier?: CapacityTier; reviewStatus?: ReviewStatus; isGalaxie?: boolean } = {};
  if (input.capacityTier !== undefined) {
    if (!(CAPACITY_TIERS as readonly string[]).includes(input.capacityTier))
      return { ok: false, error: e.invalid };
    patch.capacityTier = input.capacityTier as CapacityTier;
  }
  if (input.reviewStatus !== undefined) {
    if (!(REVIEW_STATUSES as readonly string[]).includes(input.reviewStatus))
      return { ok: false, error: e.invalid };
    patch.reviewStatus = input.reviewStatus as ReviewStatus;
  }
  if (input.isGalaxie !== undefined) patch.isGalaxie = input.isGalaxie === true;
  let issued: IssuedBrandKeys[] = [];
  try {
    const changed = await updateOrganization({ id: input.id, patch, actor: me.id, reason });
    // aprovou a revisão (PL2): as chaves nascem agora, pelo mesmo caminho do cadastro. Também quando nada mudou e a
    // organização já estava aprovada: a aprovação pode ter sido gravada numa tentativa em que a emissão falhou
    if (
      patch.reviewStatus === 'approved' &&
      (changed || (await getOrganization(input.id))?.reviewStatus === 'approved')
    )
      issued = await issueKeysForOrganization(input.id, me.id, reason);
    if (!changed && !issued.length) return { ok: false, error: e.unchanged };
  } catch (err) {
    console.error('[organizações] ação da equipe falhou', err);
    return { ok: false, error: e.generic };
  }
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${input.id}`);
  return { ok: true, issued };
}

export interface CreateOrganizationByStaffInput {
  ownerEmail: string;
  ownerName: string;
  organizationName: string;
  country: string;
  brandName: string;
  slug: string;
  capacityTier: string;
  reason: string;
}

export interface CreateOrganizationByStaffResult extends OrganizationActionResult {
  organizationId?: string;
  /** O e-mail do convite saiu? Senão, o link do login para mandar por outro canal. */
  emailSent?: boolean;
  link?: string | null;
}

/**
 * Cria uma organização para um cliente (jornada assistida, doc 02): o usuário do Dono pelo mesmo caminho dos
 * convites (sem senha, papel `client`), o provisionamento do cadastro já aprovado (`review_status = 'none'`, sem
 * aceite de termos: o Dono aceita quando o cadastro público abrir), o convite por e-mail e o registro em
 * `billing.staff_action` com o motivo. As chaves voltam uma única vez.
 */
export async function createOrganizationByStaff(
  input: CreateOrganizationByStaffInput,
): Promise<CreateOrganizationByStaffResult> {
  const me = await requireStaff();
  const locale = await getRequestLocale();
  const e = getDictionary(locale).platformStaff.errors;
  const reason = normalizeStaffReason(input?.reason);
  if (!reason) return { ok: false, error: e.reason };
  const email = normalizeEmail(input?.ownerEmail);
  if (!email) return { ok: false, error: e.email };
  const ownerName = normalizeName(input?.ownerName, PERSON_NAME_MAX);
  const organizationName = normalizeName(input?.organizationName);
  const brandName = normalizeName(input?.brandName);
  if (!ownerName || !organizationName || !brandName) return { ok: false, error: e.name };
  const country = String(input?.country ?? '').toUpperCase();
  if (!isSignupMarket(country)) return { ok: false, error: e.invalid };
  const slug = String(input?.slug ?? '')
    .trim()
    .toLowerCase();
  if (!isValidSlug(slug)) return { ok: false, error: e.slug };
  if (!(CAPACITY_TIERS as readonly string[]).includes(input?.capacityTier))
    return { ok: false, error: e.invalid };
  const capacityTier = input.capacityTier as CapacityTier;

  // o usuário do Dono: o existente (só cliente) ou um novo, sem senha, como nos convites do painel
  const { rows } = await pool.query<{ id: string; role: string | null }>(
    'select id, role from "user" where lower(email) = $1',
    [email],
  );
  if (rows[0] && rows[0].role !== 'client') return { ok: false, error: e.otherAccount };
  let userId = rows[0]?.id;
  if (!userId) {
    const created = await auth.api.createUser({
      body: {
        email,
        name: ownerName,
        role: 'client',
        data: { tenantId: null, accessExpiresAt: null, locale },
      },
    });
    userId = created.user.id;
  }

  const actor = `galaxie:${me.id}`;
  const settings = await readSignupSettings();
  let result;
  try {
    result = await provisionOrganization(builderDb(), {
      organization: {
        slug,
        name: organizationName,
        country,
        ...billingFor(country),
        capacityTier,
        reviewStatus: 'none',
        locale,
        terms: null,
      },
      brand: { slug, name: brandName },
      owner: { userId, email, accepted: false },
      catalog: catalog(),
      trialDays: settings.trialDays,
      actor,
      defaultOrigin: defaultBrandOrigin(slug, SITE_HOST),
      source: 'staff',
    });
  } catch (err) {
    if (err instanceof ProvisionError) return { ok: false, error: e.slugTaken };
    console.error('[organizações] criação assistida falhou', err);
    return { ok: false, error: e.generic };
  }
  await recordStaffAction({
    organizationId: result.organizationId,
    tenantId: result.tenantId,
    actor: me.id,
    action: 'organization.create',
    reason,
    payload: {
      input: { ownerEmail: email, organizationName, country, brandName, slug, capacityTier },
      created: result.organizationCreated,
      issued: (['live', 'test', 'publishable'] as const).filter((k) => result.keys[k]),
    },
  });
  const sent = await sendInvite(userId);
  revalidatePath(PATH);
  return {
    ok: true,
    organizationId: result.organizationId,
    issued: hasKeys(result.keys) ? [{ tenantId: result.tenantId, brand: brandName, keys: result.keys }] : [],
    emailSent: sent.emailSent,
    link: sent.link,
  };
}
