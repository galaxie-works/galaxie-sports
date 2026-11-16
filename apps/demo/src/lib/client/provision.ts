/**
 * Provisionamento de uma organização com a primeira marca (plataforma comercial F2, doc 02 §Provisionamento), só no
 * servidor. Uma função idempotente para os dois caminhos: o cadastro em autoatendimento (`/signup`) e a criação
 * assistida pela equipe em Ajustes › Organizações e marcas. Passos, cada um com a própria idempotência:
 *
 * 0. `billing.organization` (upsert por slug; o aceite dos termos só entra quando ainda não há);
 * 1. `api.tenant` (upsert por slug; plano Fan Experience, módulos do plano, `markets = [país]`,
 *    `trial_ends_at = agora + TRIAL_DAYS` só na criação, `catalog_version` como a F1 grava, faixa de capacidade na
 *    organização e nula na marca);
 * 2. `api.tenant_member` e `billing.organization_member` com quem criou como Dono (único por tenant e usuário);
 * 3. chaves secretas `live` e `test` (pula o ambiente que já tem chave válida) e uma publicável com o host padrão
 *    (pula se a marca já tem uma ativa) — só quando a revisão do cadastro não está pendente (PL2). O texto das
 *    chaves aparece uma única vez, no retorno;
 * 4. um tema da marca com a cor principal informada (pula se a marca já tem tema);
 * 5. o evento `tenant.provisioned` no outbox (`ops.change_feed`), com a faixa que a calculadora indicou e o uso
 *    declarado no payload — só na criação da marca (a F3 marca o checklist e manda o e-mail a partir dele).
 *
 * Fora daqui, para a F3: a máquina de estados (`draft`, `pending_review`…), o widget de exemplo no Builder, o cliente
 * no Stripe e o e-mail de boas-vindas. `status` e `review_status` que já existem bastam para esta fase.
 */
import { createApiKey } from '@galaxie/db/api-keys';
import { publishChange } from '@galaxie/db/change-feed';
import type { Database } from '@galaxie/db/client';
import { recordKeyEvent } from '@galaxie/db';
import {
  apiKey,
  organization,
  organizationMember,
  publishableKey,
  tenant,
  type BillingEntity,
  type OrganizationCurrency,
  type OrganizationReviewStatus,
} from '@galaxie/db/schema';
import { createPublishableKey, listWidgetThemes, saveWidgetTheme } from '@galaxie/db/widgets';
import { DEFAULT_THEMES } from '@galaxie/widgets';
import { recordCatalogVersion, type Catalog, type CapacityTier } from '@galaxie/billing';
import { and, eq, isNull, sql } from 'drizzle-orm';

/** O mesmo prazo dos convites da tela Usuários e cargos (`members.ts`); repetido para não puxar o pool do auth. */
const INVITE_TTL_DAYS = 7;

/** Plano com que a conta nasce (PL3): os três módulos do Fan Experience em teste. */
export const SIGNUP_PLAN = 'fan_experience' as const;

/** Rótulo das chaves emitidas pelo provisionamento (aparece na lista de chaves da API). */
const KEY_LABEL = 'provisionamento';
const PUBLISHABLE_KEY_NAME = 'Site principal';

export interface ProvisionInput {
  organization: {
    slug: string;
    name: string;
    /** País principal (ISO2). */
    country: string;
    currency: OrganizationCurrency;
    billingEntity: BillingEntity;
    /** No trial sempre C1 (PL3); por proposta (C3/C4) a faixa calculada, para a equipe ver. */
    capacityTier: CapacityTier;
    reviewStatus: OrganizationReviewStatus;
    locale?: string | null;
    /** Aceite dos termos de autoatendimento; null quando a equipe cria (o cliente aceita depois). */
    terms?: { version: string; acceptedBy: string; ip: string | null; acceptedAt?: Date } | null;
  };
  brand: {
    slug: string;
    name: string;
    /** Esportes de interesse (slugs); vazio = todos os do plano. */
    sports?: string[];
    /** Cor principal (`#rrggbb`) do tema da marca; null = sem tema. */
    color?: string | null;
  };
  owner: {
    userId: string;
    email: string;
    /** Quem já entrou (cadastro): o cargo nasce aceito. Convidado pela equipe: pendente, com prazo. */
    accepted: boolean;
  };
  catalog: Catalog;
  trialDays: number;
  /** Quem provisiona: `signup:<id do usuário>` ou `galaxie:<id do usuário>` (created_by, invited_by, auditoria). */
  actor: string;
  /** Origem da chave publicável (`https://<slug>.<host da plataforma>`). */
  defaultOrigin: string;
  /** Emitir as chaves (padrão: sim, quando a revisão não está pendente). */
  issueKeys?: boolean;
  /** O que a calculadora devolveu no cadastro: vai no payload do evento `tenant.provisioned`. */
  declared?: {
    usage: { viewsPerMonth: number; peakConcurrent: number; chatWriters: number };
    tier: CapacityTier;
    selfService: boolean;
  } | null;
  /** De onde veio: o cadastro público ou a equipe. */
  source: 'signup' | 'staff';
  now?: Date;
}

export interface ProvisionedKeys {
  /** Texto puro da chave emitida agora; null = já existia (ou não foi emitida). */
  live: string | null;
  test: string | null;
  publishable: string | null;
}

export interface ProvisionResult {
  organizationId: string;
  organizationCreated: boolean;
  tenantId: string;
  tenantCreated: boolean;
  reviewStatus: OrganizationReviewStatus;
  trialEndsAt: Date | null;
  keys: ProvisionedKeys;
  /** O tema da marca com a cor informada foi criado agora. */
  themeCreated: boolean;
}

/** Recusas do provisionamento (o painel traduz pelo código). */
export class ProvisionError extends Error {
  constructor(readonly code: 'organizationSlugTaken' | 'brandSlugTaken') {
    super(code);
    this.name = 'ProvisionError';
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const NO_KEYS: ProvisionedKeys = { live: null, test: null, publishable: null };

/** Convite ou cargo aceito: as datas conforme quem já entrou. */
function membershipDates(accepted: boolean, now: Date) {
  return accepted
    ? { acceptedAt: now, expiresAt: null }
    : { acceptedAt: null, expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000) };
}

async function upsertOrganization(tx: Tx, input: ProvisionInput, now: Date) {
  const o = input.organization;
  const terms = o.terms ?? null;
  const [row] = await tx
    .insert(organization)
    .values({
      slug: o.slug,
      name: o.name,
      country: o.country.toUpperCase(),
      currency: o.currency,
      billingEntity: o.billingEntity,
      capacityTier: o.capacityTier,
      reviewStatus: o.reviewStatus,
      locale: o.locale ?? null,
      termsVersion: terms?.version ?? null,
      termsAcceptedAt: terms ? (terms.acceptedAt ?? now) : null,
      termsAcceptedBy: terms?.acceptedBy ?? null,
      termsAcceptedIp: terms?.ip ?? null,
      createdBy: input.actor,
    })
    .onConflictDoUpdate({
      target: organization.slug,
      // de novo: nome atualizado e o aceite dos termos só se ainda não havia; faixa e revisão ficam como estão
      set: {
        name: o.name,
        termsVersion: sql`coalesce(${organization.termsVersion}, excluded.terms_version)`,
        termsAcceptedAt: sql`coalesce(${organization.termsAcceptedAt}, excluded.terms_accepted_at)`,
        termsAcceptedBy: sql`coalesce(${organization.termsAcceptedBy}, excluded.terms_accepted_by)`,
        termsAcceptedIp: sql`coalesce(${organization.termsAcceptedIp}, excluded.terms_accepted_ip)`,
        updatedAt: now,
      },
    })
    .returning({
      id: organization.id,
      created: sql<boolean>`(xmax = 0)`,
      reviewStatus: organization.reviewStatus,
    });
  const org = row!;
  if (!org.created) {
    // slug de outra organização: quem roda de novo tem de ser Dono dela, senão é colisão
    const [owner] = await tx
      .select({ id: organizationMember.id })
      .from(organizationMember)
      .where(
        and(
          eq(organizationMember.organizationId, org.id),
          eq(organizationMember.userId, input.owner.userId),
          eq(organizationMember.role, 'owner'),
        ),
      )
      .limit(1);
    if (!owner) throw new ProvisionError('organizationSlugTaken');
  }
  return org;
}

async function upsertTenant(tx: Tx, input: ProvisionInput, organizationId: string, now: Date) {
  const plan = input.catalog.plans[SIGNUP_PLAN];
  const [existing] = await tx
    .select({ id: tenant.id, organizationId: tenant.organizationId })
    .from(tenant)
    .where(eq(tenant.slug, input.brand.slug))
    .limit(1);
  if (existing && existing.organizationId !== organizationId) throw new ProvisionError('brandSlugTaken');
  await recordCatalogVersion(tx as unknown as Database, input.catalog.version);
  const [row] = await tx
    .insert(tenant)
    .values({
      slug: input.brand.slug,
      name: input.brand.name,
      plan: SIGNUP_PLAN,
      modules: [...plan.modules],
      markets: [input.organization.country.toUpperCase()],
      sports: input.brand.sports ?? [],
      rateLimitPerMinute: plan.rateLimitPerMinute,
      dailyRequestQuota: plan.dailyRequestQuota,
      trialEndsAt: new Date(now.getTime() + input.trialDays * 86_400_000),
      catalogVersion: input.catalog.version,
      // a faixa é da organização (PL23): a coluna da marca fica nula
      capacityTier: null,
      organizationId,
    })
    .onConflictDoUpdate({
      target: tenant.slug,
      // de novo: só o nome; o prazo do trial e a organização gravados na criação ficam
      set: {
        name: input.brand.name,
        trialEndsAt: sql`coalesce(${tenant.trialEndsAt}, excluded.trial_ends_at)`,
        organizationId: sql`coalesce(${tenant.organizationId}, excluded.organization_id)`,
        updatedAt: now,
      },
    })
    .returning({ id: tenant.id, created: sql<boolean>`(xmax = 0)`, trialEndsAt: tenant.trialEndsAt });
  return row!;
}

async function addOwner(tx: Tx, input: ProvisionInput, organizationId: string, tenantId: string, now: Date) {
  const { acceptedAt, expiresAt } = membershipDates(input.owner.accepted, now);
  const created = await tx.execute<{ id: string }>(sql`
    insert into api.tenant_member (tenant_id, user_id, role, invited_by, accepted_at, invite_expires_at)
    values (${tenantId}, ${input.owner.userId}, 'owner', ${input.actor},
            ${acceptedAt?.toISOString() ?? null}::timestamptz, ${expiresAt?.toISOString() ?? null}::timestamptz)
    on conflict (tenant_id, user_id) where user_id is not null do nothing
    returning id::text`);
  for (const r of created) {
    await tx.execute(sql`
      insert into api.tenant_member_event (tenant_id, member_id, action, actor, to_role, subject)
      values (${tenantId}, ${r.id}::uuid, 'invited', ${input.actor}, 'owner', ${input.owner.email})`);
    if (input.owner.accepted)
      await tx.execute(sql`
        insert into api.tenant_member_event (tenant_id, member_id, action, actor)
        values (${tenantId}, ${r.id}::uuid, 'accepted', ${input.actor})`);
  }
  await tx
    .insert(organizationMember)
    .values({
      organizationId,
      userId: input.owner.userId,
      role: 'owner',
      invitedBy: input.actor,
      acceptedAt,
      expiresAt,
    })
    .onConflictDoNothing({ target: [organizationMember.organizationId, organizationMember.userId] });
}

/**
 * Emite o que falta: a chave secreta de cada ambiente sem chave válida e a publicável quando a marca não tem nenhuma
 * ativa. Rodar de novo não emite nada. Devolve só as chaves emitidas agora (uma única vez).
 */
export async function issueMissingKeys(
  db: Database,
  input: { tenantId: string; actor: string; defaultOrigin: string; now?: Date },
): Promise<ProvisionedKeys> {
  const now = input.now ?? new Date();
  const keys: ProvisionedKeys = { ...NO_KEYS };
  for (const env of ['live', 'test'] as const) {
    const issued = await db.transaction(async (tx) => {
      await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, input.tenantId)).for('update');
      const [active] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(apiKey)
        .where(
          and(
            eq(apiKey.tenantId, input.tenantId),
            eq(apiKey.env, env),
            isNull(apiKey.revokedAt),
            sql`(${apiKey.expiresAt} is null or ${apiKey.expiresAt} > ${now.toISOString()}::timestamptz)`,
          ),
        );
      if ((active?.n ?? 0) > 0) return null;
      const key = await createApiKey(tx, input.tenantId, { env, label: KEY_LABEL });
      await recordKeyEvent(tx, {
        tenantId: input.tenantId,
        keyKind: 'secret',
        keyId: key.id,
        prefix: key.prefix,
        action: 'issued',
        actor: input.actor,
        detail: { env, label: KEY_LABEL },
      });
      return key.key;
    });
    keys[env] = issued;
  }
  const [publishable] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(publishableKey)
    .where(and(eq(publishableKey.tenantId, input.tenantId), isNull(publishableKey.revokedAt)));
  if ((publishable?.n ?? 0) === 0) {
    const created = await createPublishableKey(db, {
      tenantId: input.tenantId,
      name: PUBLISHABLE_KEY_NAME,
      allowedOrigins: [input.defaultOrigin],
      env: 'live',
      actor: input.actor,
    });
    keys.publishable = created.key;
  }
  return keys;
}

/** Tema da marca com a cor principal informada no cadastro, se a marca ainda não tem tema. */
async function ensureBrandTheme(db: Database, input: ProvisionInput, tenantId: string): Promise<boolean> {
  const color = input.brand.color;
  if (!color) return false;
  if ((await listWidgetThemes(db, tenantId)).length) return false;
  await saveWidgetTheme(db, {
    tenantId,
    name: input.brand.name,
    theme: { ...DEFAULT_THEMES.dark, primary: color },
    createdBy: input.actor,
  });
  return true;
}

/** Marcas de uma organização, para emitir as chaves ao aprovar a revisão (Ajustes › Organizações e marcas). */
export async function listOrganizationBrands(
  db: Database,
  organizationId: string,
): Promise<{ id: string; slug: string; name: string }[]> {
  return db
    .select({ id: tenant.id, slug: tenant.slug, name: tenant.name })
    .from(tenant)
    .where(eq(tenant.organizationId, organizationId))
    .orderBy(tenant.name, tenant.slug);
}

/**
 * Cria (ou completa) a organização, a marca, o Dono e as chaves. Transacional nos passos 0 a 2; as chaves vêm
 * depois, cada uma idempotente, para o texto delas aparecer uma só vez mesmo que a emissão falhe no meio e rode de
 * novo. Rodar duas vezes com o mesmo pedido não duplica nada.
 */
export async function provisionOrganization(db: Database, input: ProvisionInput): Promise<ProvisionResult> {
  const now = input.now ?? new Date();
  const base = await db.transaction(async (tx) => {
    const org = await upsertOrganization(tx, input, now);
    const t = await upsertTenant(tx, input, org.id, now);
    await addOwner(tx, input, org.id, t.id, now);
    if (t.created)
      await publishChange(tx, {
        topic: 'tenant.provisioned',
        entityType: 'tenant',
        entityId: t.id,
        payload: {
          organization_id: org.id,
          tenant_id: t.id,
          source: input.source,
          review_status: org.reviewStatus,
          capacity_tier: input.organization.capacityTier,
          declared: input.declared ?? null,
          trial_ends_at: t.trialEndsAt?.toISOString() ?? null,
        },
      });
    return { org, t };
  });
  const reviewStatus = base.org.reviewStatus;
  // nada de produção para quem está em revisão (PL2): as chaves nascem quando a equipe aprovar
  const issue = (input.issueKeys ?? true) && reviewStatus !== 'pending' && reviewStatus !== 'rejected';
  const keys = issue
    ? await issueMissingKeys(db, {
        tenantId: base.t.id,
        actor: input.actor,
        defaultOrigin: input.defaultOrigin,
        now,
      })
    : { ...NO_KEYS };
  const themeCreated = await ensureBrandTheme(db, input, base.t.id);
  return {
    organizationId: base.org.id,
    organizationCreated: base.org.created,
    tenantId: base.t.id,
    tenantCreated: base.t.created,
    reviewStatus,
    trialEndsAt: base.t.trialEndsAt,
    keys,
    themeCreated,
  };
}
