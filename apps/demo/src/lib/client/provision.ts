/**
 * Provisionamento de uma organização com a primeira marca (plataforma comercial F2, doc 02 §Provisionamento), só no
 * servidor. Uma função idempotente para os dois caminhos: o cadastro em autoatendimento (`/signup`) e a criação
 * assistida pela equipe em Ajustes › Organizações e marcas. Passos, cada um com a própria idempotência:
 *
 * 0. `billing.organization` (upsert por slug; o aceite dos termos só entra quando ainda não há);
 * 1. `api.tenant` (upsert por slug; plano Fan Experience, módulos do plano, `markets = [país]`,
 *    `trial_ends_at = agora + TRIAL_DAYS` só na criação, `catalog_version` como a F1 grava, faixa de capacidade na
 *    organização e nula na marca). A marca nasce em `draft` e, na mesma transação, vai a `trial` ou, com a revisão do
 *    cadastro pendente (PL2), a `pending_review` (máquina de estados da F3, decisão 6; `transitionTenantState` de
 *    `@galaxie/billing`, evento `signup` ou `provision`);
 * 2. `api.tenant_member` e `billing.organization_member` com quem criou como Dono (único por tenant e usuário);
 * 3. chaves secretas `live` e `test` (pula o ambiente que já tem chave válida) e uma publicável com o host padrão
 *    (pula se a marca já tem uma ativa), as três na mesma transação: falhou uma, nenhuma fica gravada e a repetição
 *    emite tudo de novo — só quando a revisão do cadastro não está pendente (PL2). O texto das chaves aparece uma
 *    única vez, no retorno;
 * 4. um tema da marca com a cor principal informada (pula se a marca já tem tema);
 * 5. um widget de exemplo no Builder (F3, decisão 10): "Placar do dia", do tipo `live_list` (jogos do dia com placar;
 *    é o tipo de placar sem parâmetro obrigatório, ao contrário do `match_card`, que pede um jogo), seguindo o tema da
 *    marca do passo 4 quando há, no idioma da organização e no mercado do país dela (pula se a marca já tem widget).
 *    Nasce também com a revisão pendente: sem chave, o widget não alcança dado nenhum, e o checklist mostra o embed dele
 *    assim que a equipe aprovar;
 * 6. o evento `tenant.provisioned` no outbox (`ops.change_feed`), com a faixa que a calculadora indicou e o uso
 *    declarado no payload — só na criação da marca;
 * 7. o e-mail de boas-vindas com o checklist (F3, decisão 11), aos Donos e ao Financeiro da organização, no idioma
 *    dela, quando a marca está em `trial` (`lib/client/welcome-email.ts`; registrado em `billing.tenant_notification`,
 *    uma vez; sem SMTP, log). A marca que ficou em `pending_review` recebe ao ser aprovada (Ajustes › Organizações).
 *    A falha do e-mail não derruba o provisionamento.
 *
 * No cadastro (`source: 'signup'`), antes do passo 0 e na mesma transação, a regra "um trial por domínio de e-mail de
 * empresa" (PL2) é conferida de novo com trava consultiva no banco: a conferência da tela (`signup/actions.ts`) só
 * roda quando o e-mail ainda não tem usuário, e duas requisições simultâneas não podem passar juntas.
 *
 * Fora daqui: o cliente no Stripe (F4). O job `tenant.provision` do doc 02 não entra enquanto não houver passo
 * externo: o provisionamento segue síncrono.
 */
import { createApiKey } from '@galaxie/db/api-keys';
import { publishChange } from '@galaxie/db/change-feed';
import type { Database } from '@galaxie/db/client';
import { recordKeyEvent } from '@galaxie/db/key-events';
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
import {
  generatePublishableKey,
  listWidgets,
  listWidgetThemes,
  MAX_PUBLISHABLE_KEYS_PER_TENANT,
  normalizeAllowedOrigin,
  saveWidget,
  saveWidgetTheme,
  type WidgetConfig,
} from '@galaxie/db/widgets';
import { DEFAULT_THEMES } from '@galaxie/widgets';
import {
  recordCatalogVersion,
  recordTenantCreated,
  transitionTenantState,
  type Catalog,
  type CapacityTier,
} from '@galaxie/billing';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { AUTH_SCHEMA } from '@/lib/auth/db';
import { organizationLocale, sendWelcomeEmail } from '@/lib/client/welcome-email';
import { getDictionary } from '@/lib/i18n/dictionary';
import { emailDomain, isFreeEmailDomain } from '@/lib/signup/email-domain';

/** O mesmo prazo dos convites da tela Usuários e cargos (`members.ts`); repetido para não puxar o pool do auth. */
const INVITE_TTL_DAYS = 7;

/** Plano com que a conta nasce (PL3): os três módulos do Fan Experience em teste. */
export const SIGNUP_PLAN = 'fan_experience' as const;

/** Rótulo das chaves emitidas pelo provisionamento (aparece na lista de chaves da API). */
const KEY_LABEL = 'provisionamento';
const PUBLISHABLE_KEY_NAME = 'Site principal';

/** Tipo do widget de exemplo (passo 5): jogos do dia com placar, sem parâmetro obrigatório. */
export const SAMPLE_WIDGET_KIND = 'live_list' as const;

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
  /** O widget de exemplo foi criado agora (false quando a marca já tinha widget). */
  sampleWidgetCreated: boolean;
  /** O e-mail de boas-vindas saiu agora para ao menos um destinatário (false se já tinha saído, ou sem SMTP). */
  welcomeSent: boolean;
}

/** Recusas do provisionamento (o painel traduz pelo código). */
export class ProvisionError extends Error {
  constructor(
    readonly code: 'organizationSlugTaken' | 'brandSlugTaken' | 'domainInTrial',
    /** `domainInTrial`: a organização em trial que já existe para o domínio. */
    readonly organizationName: string | null = null,
  ) {
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

/**
 * Um trial por domínio de e-mail de empresa (PL2): outra organização em trial cujo Dono tem o mesmo domínio e da qual
 * quem provisiona não é Dono (a repetição do próprio cadastro passa). Serializa por domínio com uma trava consultiva
 * da transação, para dois cadastros simultâneos do mesmo domínio não passarem juntos.
 */
async function assertDomainFree(tx: Tx, input: ProvisionInput) {
  const domain = emailDomain(input.owner.email.toLowerCase());
  if (isFreeEmailDomain(domain)) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`signup-domain:${domain}`}))`);
  const rows = await tx.execute<{ name: string }>(sql`
    select o.name
      from billing.organization o
      join billing.organization_member om on om.organization_id = o.id and om.role = 'owner'
      join ${sql.raw(`"${AUTH_SCHEMA}"."user"`)} u on u.id = om.user_id
     where split_part(lower(u.email), '@', 2) = ${domain}
       and exists (select 1 from api.tenant t where t.organization_id = o.id and t.trial_ends_at > now())
       and not exists (
         select 1 from billing.organization_member mine
          where mine.organization_id = o.id and mine.user_id = ${input.owner.userId})
     order by o.created_at
     limit 1`);
  const taken = rows[0];
  if (taken) throw new ProvisionError('domainInTrial', taken.name);
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

async function upsertTenant(
  tx: Tx,
  input: ProvisionInput,
  organizationId: string,
  reviewStatus: OrganizationReviewStatus,
  now: Date,
) {
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
      // a máquina de estados (F3): nasce em draft e muda logo abaixo, na mesma transação
      state: 'draft',
      stateSince: now,
    })
    .onConflictDoUpdate({
      target: tenant.slug,
      // de novo: só o nome; o prazo do trial, a organização e o estado gravados na criação ficam
      set: {
        name: input.brand.name,
        trialEndsAt: sql`coalesce(${tenant.trialEndsAt}, excluded.trial_ends_at)`,
        organizationId: sql`coalesce(${tenant.organizationId}, excluded.organization_id)`,
        updatedAt: now,
      },
    })
    .returning({ id: tenant.id, created: sql<boolean>`(xmax = 0)`, trialEndsAt: tenant.trialEndsAt });
  const t = row!;
  if (t.created) {
    // decisão 6: draft → trial, ou → pending_review quando o cadastro caiu numa regra antiabuso (PL2)
    const cause = input.source === 'signup' ? 'signup' : 'provision';
    await recordTenantCreated(tx, t.id, { cause, actor: input.actor, now });
    await transitionTenantState(tx, t.id, reviewStatus === 'pending' ? 'pending_review' : 'trial', {
      cause,
      actor: input.actor,
      now,
      payload: { review_status: reviewStatus, trial_ends_at: t.trialEndsAt?.toISOString() ?? null },
    });
  }
  return t;
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
 * ativa, tudo numa transação só (com a linha do tenant travada): falhou qualquer uma, nenhuma fica gravada e o texto
 * de nenhuma se perde. Rodar de novo não emite nada. Devolve só as chaves emitidas agora (uma única vez).
 */
export async function issueMissingKeys(
  db: Database,
  input: { tenantId: string; actor: string; defaultOrigin: string; now?: Date },
): Promise<ProvisionedKeys> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const keys: ProvisionedKeys = { ...NO_KEYS };
    await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, input.tenantId)).for('update');
    for (const env of ['live', 'test'] as const) {
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
      if ((active?.n ?? 0) > 0) continue;
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
      keys[env] = key.key;
    }
    const [publishable] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(publishableKey)
      .where(and(eq(publishableKey.tenantId, input.tenantId), isNull(publishableKey.revokedAt)));
    if ((publishable?.n ?? 0) === 0) {
      // a mesma emissão de `createPublishableKey` (@galaxie/db/widgets), dentro desta transação
      const origin = normalizeAllowedOrigin(input.defaultOrigin);
      if (!origin) throw new Error(`Origem padrão inválida para a chave publicável: ${input.defaultOrigin}`);
      if (publishable!.n >= MAX_PUBLISHABLE_KEYS_PER_TENANT)
        throw new Error('A marca já tem o máximo de chaves publicáveis ativas.');
      const generated = generatePublishableKey('live');
      const [row] = await tx
        .insert(publishableKey)
        .values({
          tenantId: input.tenantId,
          name: PUBLISHABLE_KEY_NAME,
          env: 'live',
          prefix: generated.prefix,
          keyHash: generated.keyHash,
          allowedOrigins: [origin],
          widgetId: null,
        })
        .returning({ id: publishableKey.id });
      await recordKeyEvent(tx, {
        tenantId: input.tenantId,
        keyKind: 'publishable',
        keyId: row!.id,
        prefix: generated.prefix,
        action: 'issued',
        actor: input.actor,
        detail: { env: 'live', name: PUBLISHABLE_KEY_NAME },
      });
      keys.publishable = generated.key;
    }
    return keys;
  });
}

/**
 * Tema da marca com a cor principal informada no cadastro, se a marca ainda não tem tema. Devolve o tema que o widget
 * de exemplo segue: o criado agora, ou o primeiro que a marca já tinha (null sem cor e sem tema).
 */
async function ensureBrandTheme(
  db: Database,
  input: ProvisionInput,
  tenantId: string,
): Promise<{ created: boolean; themeId: string | null }> {
  const existing = await listWidgetThemes(db, tenantId);
  if (existing.length) return { created: false, themeId: existing[0]!.id };
  const color = input.brand.color;
  if (!color) return { created: false, themeId: null };
  const { theme } = await saveWidgetTheme(db, {
    tenantId,
    name: input.brand.name,
    theme: { ...DEFAULT_THEMES.dark, primary: color },
    createdBy: input.actor,
  });
  return { created: true, themeId: theme.id };
}

export interface SampleWidgetInput {
  tenantId: string;
  /** Idioma da organização (`billing.organization.locale`); null = pt-BR. */
  locale: string | null | undefined;
  /** País principal da organização (ISO2): o mercado do widget. */
  market: string;
  /** Esporte em foco (slug); null = o widget mostra todos. */
  sport: string | null;
  /** Tema da marca que o widget segue; null = tema padrão só do widget. */
  brandThemeId: string | null;
  actor: string;
}

/**
 * Widget de exemplo "Placar do dia" (F3, decisão 10; doc 02 §Provisionamento, passo 5), se a marca ainda não tem
 * widget no Builder. Devolve true quando criou agora. A visão geral do console mostra o embed dele no passo 2 do
 * checklist.
 */
export async function ensureSampleWidget(db: Database, input: SampleWidgetInput): Promise<boolean> {
  if ((await listWidgets(db, input.tenantId)).length) return false;
  const locale = organizationLocale(input.locale);
  const config: WidgetConfig = {
    theme: DEFAULT_THEMES.dark,
    ...(input.brandThemeId ? { brandThemeId: input.brandThemeId } : {}),
    // o widget fala pt-BR, es ou en (o Builder reduz `es-AR` a `es`)
    locale: locale === 'es-AR' ? 'es' : locale,
    market: input.market.toUpperCase(),
    defaults: input.sport ? { sport: input.sport } : {},
    liveList: { groupByCompetition: true, autoRefresh: true, limit: 10 },
  };
  await saveWidget(db, {
    tenantId: input.tenantId,
    kind: SAMPLE_WIDGET_KIND,
    // o nome no idioma da organização ("Placar do dia"), do dicionário do console
    name: getDictionary(locale).client.checklist.sampleWidgetName,
    config,
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
    if (input.source === 'signup') await assertDomainFree(tx, input);
    const org = await upsertOrganization(tx, input, now);
    const t = await upsertTenant(tx, input, org.id, org.reviewStatus, now);
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
  const theme = await ensureBrandTheme(db, input, base.t.id);
  const sampleWidgetCreated = await ensureSampleWidget(db, {
    tenantId: base.t.id,
    locale: input.organization.locale,
    market: input.organization.country,
    sport: input.brand.sports?.[0] ?? null,
    brandThemeId: theme.themeId,
    actor: input.actor,
  });
  // boas-vindas quando a marca está em trial (a que ficou em revisão recebe na aprovação); uma vez, pelo registro
  let welcomeSent = false;
  if (issue) {
    try {
      welcomeSent = (await sendWelcomeEmail(db, { tenantId: base.t.id, now })).delivered;
    } catch (err) {
      console.error('[provisionamento] e-mail de boas-vindas falhou', err);
    }
  }
  return {
    organizationId: base.org.id,
    organizationCreated: base.org.created,
    tenantId: base.t.id,
    tenantCreated: base.t.created,
    reviewStatus,
    trialEndsAt: base.t.trialEndsAt,
    keys,
    themeCreated: theme.created,
    sampleWidgetCreated,
    welcomeSent,
  };
}
