import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { platform } from './lineups.js';
import {
  ENGAGE_MODULES,
  isEngageModule,
  type EngageModule,
  type ModuleLimitKey,
  type ModuleUsageMetric,
} from '../engage-modules.js';

export * from '../engage-modules.js';

/** Schema da API pública: tenants, chaves de acesso e fila de backfill do espelho (docs/05 §1–2). */
export const api = pgSchema('api');

/** Módulos vendáveis (docs/01 §pacotes). Cada rota da API exige um módulo. */
export const API_MODULES = [
  'core_data',
  'where_to_watch',
  'semantic',
  'live_intelligence',
  'multisport',
  /** Add-on: vídeos relacionados por evento (docs/12). */
  'related_content',
  /** Add-on: odds pré-jogo por evento, em consenso entre as casas (docs/05 §3.2.2). */
  'odds',
  // Engajamento do torcedor (#1017, #1018): vendidos por módulo, nunca incluídos num plano por padrão.
  ...ENGAGE_MODULES,
] as const;
export type ApiModule = (typeof API_MODULES)[number];

/** Módulos de dados (API esportiva): tudo o que não é engajamento. */
export const DATA_MODULES = API_MODULES.filter((m) => !isEngageModule(m)) as Exclude<
  ApiModule,
  EngageModule
>[];

export const API_PLANS = ['trial', 'core_data', 'fan_experience', 'live_intelligence', 'enterprise'] as const;
export type ApiPlan = (typeof API_PLANS)[number];

/** Planos sem tempo real: nem SSE (`/v1/stream`) nem webhooks (docs/politica-de-chaves.md §3). */
export const PLANS_WITHOUT_REALTIME: readonly ApiPlan[] = ['trial'];

/** Módulos incluídos por padrão em cada plano (o tenant pode ter uma lista personalizada). */
export const PLAN_MODULES: Record<ApiPlan, readonly ApiModule[]> = {
  trial: ['core_data'],
  core_data: ['core_data'],
  fan_experience: ['core_data', 'where_to_watch', 'semantic'],
  live_intelligence: ['core_data', 'where_to_watch', 'semantic', 'live_intelligence', 'multisport'],
  // lista explícita: um módulo novo em API_MODULES não entra de graça no Enterprise (engajamento é por contrato)
  enterprise: [
    'core_data',
    'where_to_watch',
    'semantic',
    'live_intelligence',
    'multisport',
    'related_content',
    'odds',
  ],
};

export const tenantStatus = api.enum('tenant_status', ['active', 'suspended']);

/** Cliente da API: plano, módulos, mercados (países) e esportes contratados. */
export const tenant = api.table(
  'tenant',
  {
    id: pkUuidV7(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    plan: text('plan').$type<ApiPlan>().notNull(),
    modules: text('modules').array().$type<ApiModule[]>().notNull(),
    /** Países (ISO2) contratados; lista vazia = todos os mercados. */
    markets: text('markets').array().notNull().default([]),
    /** Esportes contratados (slug); lista vazia = todos. */
    sports: text('sports').array().notNull().default([]),
    /** Requisições por minuto, por rota. */
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(120),
    /**
     * Cota diária de requisições de produção (todas as rotas; a chave de teste fica fora); null = sem cota.
     * Aviso a partir de 80% e 429 QUOTA_EXCEEDED a partir de 110%, até a virada do dia UTC.
     */
    dailyRequestQuota: integer('daily_request_quota'),
    /** Fim do trial (plano `trial`): depois dele nenhuma chave do tenant autentica. null = sem prazo. */
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    status: tenantStatus('status').notNull().default('active'),
    /** Plataforma (enrich.platform) quando o cliente é uma operadora/streaming da grade. */
    operatorPlatformId: uuid('operator_platform_id').references((): AnyPgColumn => platform.id, {
      onDelete: 'set null',
    }),
    /** No onde assistir do cliente operadora, mostra também as outras plataformas (padrão: só a dele). */
    showOtherOperators: boolean('show_other_operators').notNull().default(false),
    /** Domínios de e-mail da operadora (sem @), para ligar usuários do portal ao tenant. */
    operatorEmailDomains: text('operator_email_domains')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Versão do catálogo comercial que o tenant assinou (`billing.catalog_version`, plataforma comercial #1137): o preço
     * vale até a renovação. null = tenant anterior ao catálogo.
     */
    catalogVersion: text('catalog_version'),
    /** Faixa de capacidade contratada (C1 a C4, `config/catalog/capacity.yaml`); null = padrão do catálogo. */
    capacityTier: text('capacity_tier').$type<'C1' | 'C2' | 'C3' | 'C4'>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'tenant_capacity_tier',
      sql`${t.capacityTier} is null or ${t.capacityTier} in ('C1', 'C2', 'C3', 'C4')`,
    ),
  ],
);

/**
 * Chave de acesso (`gs_live_<prefixo>_<segredo>`). Só o prefixo fica em claro (busca);
 * o segredo é guardado como hash scrypt com sal. A chave completa é exibida uma única vez.
 */
export const apiKey = api.table(
  'api_key',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    prefix: text('prefix').notNull(),
    /** Ambiente do prefixo da chave (`gs_live_` / `gs_test_`). */
    env: text('env').$type<'live' | 'test'>().notNull().default('live'),
    /** scrypt$N$r$p$sal$hash (base64url). */
    secretHash: text('secret_hash').notNull(),
    label: text('label'),
    /** Restringe os módulos do tenant para esta chave; null = herda todos os módulos do tenant. */
    scopes: text('scopes').array().$type<ApiModule[]>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Quando a chave foi substituída por uma rotação (fica válida só no período de graça). Uma chave
     * já rotacionada não pode ser rotacionada de novo: quem tem só a chave antiga não gera outra.
     */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    /**
     * Formato da chave: 1 = legado (`gs_<env>_<prefixo>_<segredo>`, ambiente das chaves anteriores à 0007
     * desconhecido); 2 = com checksum (`..._<crc32>`, docs/politica-de-chaves.md). As de formato 1 são
     * revogadas e reemitidas por `pnpm --filter @galaxie/api keys:migrate` (docs/runbooks/migracao-de-chaves.md).
     */
    keyFormat: integer('key_format').notNull().default(1),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_key_prefix_uq').on(t.prefix), index('api_key_tenant_idx').on(t.tenantId)],
);

/**
 * Auditoria das chaves (secretas e publicáveis): emissão, rotação, revogação e migração, com quem fez e
 * quando. Nunca guarda o segredo, só o prefixo (docs/politica-de-chaves.md §5).
 */
export const apiKeyEvent = api.table(
  'api_key_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** `secret` (api.api_key) ou `publishable` (ops.publishable_key). */
    keyKind: text('key_kind').$type<'secret' | 'publishable'>().notNull(),
    keyId: uuid('key_id').notNull(),
    prefix: text('prefix').notNull(),
    /** issued | rotated | revoked | migrated */
    action: text('action').$type<'issued' | 'rotated' | 'revoked' | 'migrated'>().notNull(),
    /** Quem fez: `admin`, `tenant` (autoatendimento), `cli:<comando>`, `panel:<id do usuário>`, `widget`. */
    actor: text('actor').notNull(),
    /** Contexto (ex.: chave nova da rotação, período de graça). Nunca segredos. */
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('api_key_event_tenant_idx').on(t.tenantId, t.createdAt)],
);

/**
 * Uso diário por tenant × rota (padrão da rota, ex.: `GET /v1/competitions/:id`). Os contadores
 * vivem no Valkey (HINCRBY em chaves diárias) e são consolidados aqui periodicamente; `requests`
 * é o total acumulado do dia (o flush é idempotente).
 */
export const usageDaily = api.table(
  'usage_daily',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Dia em UTC. */
    day: date('day', { mode: 'string' }).notNull(),
    route: text('route').notNull(),
    requests: bigint('requests', { mode: 'number' }).notNull().default(0),
    /**
     * Época do hash do Valkey que alimentou a última consolidação (`#epoca`) e `epoch_base`, o consolidado
     * das épocas anteriores. Mesma época: `requests = greatest(requests, base + contador)`; época nova
     * (Valkey zerado): `base := requests` e soma. Só `greatest()`, então uma versão anterior da API que
     * consolide junto (rollout, rollback) não faz o total crescer em dobro. null = linha anterior às épocas.
     */
    epoch: text('epoch'),
    epochBase: bigint('epoch_base', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day, t.route] }), index('usage_daily_day_idx').on(t.day)],
);

/**
 * Faixa de um módulo de engajamento no tenant (#1018). Sem linha = padrão de `MODULE_LIMITS`. Só a Galaxie
 * grava (rota administrativa); o cliente vê no painel.
 */
export const tenantModuleLimit = api.table(
  'tenant_module_limit',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Chave de `MODULE_LIMITS` (`modulo.faixa`). */
    key: text('key').$type<ModuleLimitKey>().notNull(),
    value: integer('value').notNull(),
    /** Quem mudou: `admin`, `cli:<comando>`, `panel:<id do usuário>`. */
    updatedBy: text('updated_by').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

/**
 * Uso por módulo de engajamento, tenant e mês (#1018). Os contadores vivem no Valkey durante o mês e são
 * consolidados aqui; `value` só cresce dentro do mês (o consolidado guarda o maior visto), então uma perda do
 * Valkey nunca diminui o que o cliente já viu.
 */
export const moduleUsageMonthly = api.table(
  'module_usage_monthly',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Primeiro dia do mês, em UTC. */
    month: date('month', { mode: 'string' }).notNull(),
    module: text('module').$type<EngageModule>().notNull(),
    metric: text('metric').$type<ModuleUsageMetric>().notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    /**
     * Época da chave do Valkey que alimentou a última consolidação e `epoch_base`, o consolidado das épocas
     * anteriores (a mesma regra de `usage_daily`). Mesma época: `value = greatest(value, base + lido)`; época
     * nova (Valkey zerado no meio do mês): `base := value` e o que vier depois soma, em vez de o `greatest()`
     * congelar o uso. `peak_connections` é um máximo e fica sempre no `greatest()`.
     */
    epoch: text('epoch'),
    epochBase: bigint('epoch_base', { mode: 'number' }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.month, t.module, t.metric] }),
    index('module_usage_monthly_month_idx').on(t.month),
  ],
);

/** Cargos da equipe do cliente (#1019); a matriz de permissões fica em `@galaxie/engage` (`can`). */
export const TENANT_MEMBER_ROLES = ['owner', 'admin', 'senior_moderator', 'moderator', 'volunteer'] as const;
export type TenantMemberRole = (typeof TENANT_MEMBER_ROLES)[number];

/** Onde o cargo vale: null = tenant inteiro; senão, só as Comunidades e Salas do Jogo listadas. */
export type TenantMemberScope = { communities?: string[]; rooms?: string[] };

/**
 * Membro da equipe de um tenant, com cargo e escopo (#1019). É uma pessoa do console (usuário da demo,
 * `demo_auth.user.id`) ou um Perfil de torcedor promovido a Voluntário (`fan.profile`, onda 2). Uma pessoa pode ter
 * cargo em vários tenants, um por tenant. O Voluntário é sempre um Perfil, nunca um usuário do console.
 */
export const tenantMember = api.table(
  'tenant_member',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Usuário do console (texto do Better Auth); null quando é um Perfil. */
    userId: text('user_id'),
    /** Perfil de torcedor (Voluntário); null quando é usuário do console. */
    profileId: uuid('profile_id'),
    role: text('role').$type<TenantMemberRole>().notNull(),
    scope: jsonb('scope').$type<TenantMemberScope>(),
    /** Quem convidou ou promoveu: `panel:<id do usuário>`, `galaxie:<id>`, `legacy`. */
    invitedBy: text('invited_by').notNull(),
    /** Primeiro acesso depois do convite; null = convite pendente. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tenant_member_user_uq')
      .on(t.tenantId, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex('tenant_member_profile_uq')
      .on(t.tenantId, t.profileId)
      .where(sql`${t.profileId} is not null`),
    index('tenant_member_user_idx').on(t.userId),
    check('tenant_member_one_identity', sql`(${t.userId} is null) <> (${t.profileId} is null)`),
    check(
      'tenant_member_role',
      sql`${t.role} in ('owner', 'admin', 'senior_moderator', 'moderator', 'volunteer')`,
    ),
    check('tenant_member_volunteer_is_profile', sql`${t.role} <> 'volunteer' or ${t.profileId} is not null`),
  ],
);

/**
 * Permissões por cargo que o Dono mudou no tenant (#1019). Só o que difere da matriz `ACTIONS` de `@galaxie/engage`
 * fica aqui; sem linha, vale o padrão. O Dono, as ações fixas e o piso de cada ação não são configuráveis: o
 * `normalizeOverrides` descarta o que vier a mais.
 */
export const tenantRolePermission = api.table(
  'tenant_role_permission',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    role: text('role').$type<TenantMemberRole>().notNull(),
    /** Ação da matriz, ex.: `cosmos.manage`. */
    action: text('action').notNull(),
    allowed: boolean('allowed').notNull(),
    /** Quem mudou: `panel:<id do usuário>` ou `galaxie:<id>`. */
    updatedBy: text('updated_by').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.role, t.action] }),
    check(
      'tenant_role_permission_role',
      sql`${t.role} in ('admin', 'senior_moderator', 'moderator', 'volunteer')`,
    ),
  ],
);

/**
 * Auditoria dos cargos (#1019): quem deu, trocou ou tirou o cargo de quem, quem mudou as permissões de um cargo, e
 * quando. Só cresce: o painel nunca altera nem apaga uma linha.
 */
export const tenantMemberEvent = api.table(
  'tenant_member_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    /** Membro afetado (o id fica mesmo depois de removido); null nas mudanças de permissão, que valem para o cargo. */
    memberId: uuid('member_id'),
    /**
     * `invited` | `accepted` | `role_changed` | `scope_changed` | `removed`; `permission_granted` |
     * `permission_revoked` (cargo em `to_role`, ação em `subject`).
     */
    action: text('action')
      .$type<
        | 'invited'
        | 'accepted'
        | 'role_changed'
        | 'scope_changed'
        | 'removed'
        | 'permission_granted'
        | 'permission_revoked'
      >()
      .notNull(),
    /** Quem fez: `panel:<id do usuário>`, `galaxie:<id>`, `legacy`. */
    actor: text('actor').notNull(),
    fromRole: text('from_role').$type<TenantMemberRole>(),
    toRole: text('to_role').$type<TenantMemberRole>(),
    /** E-mail ou Apelido no momento do evento, para a auditoria ler sem juntar com outra tabela. */
    subject: text('subject'),
    createdAt: createdAt(),
  },
  (t) => [index('tenant_member_event_tenant_idx').on(t.tenantId, t.createdAt)],
);

/**
 * Combinações pedidas ao espelho que não existem no raw. O espelho nunca chama o fornecedor
 * em tempo real: a combinação entra aqui e o Quota Governor a busca com prioridade ADHOC.
 */
export const backfillRequest = api.table(
  'backfill_request',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: text('provider').notNull().default('api-sports'),
    sport: text('sport').notNull(),
    endpoint: text('endpoint').notNull(),
    params: jsonb('params').$type<Record<string, string>>().notNull(),
    requestHash: text('request_hash').notNull(),
    priority: text('priority').notNull().default('ADHOC'),
    /** pending | done | failed | skipped */
    status: text('status').notNull().default('pending'),
    /** Quantas vezes a combinação foi pedida (ajuda a priorizar). */
    hits: integer('hits').notNull().default(1),
    tenantId: uuid('tenant_id').references(() => tenant.id, { onDelete: 'set null' }),
    firstRequestedAt: timestamp('first_requested_at', { withTimezone: true }).notNull().defaultNow(),
    lastRequestedAt: timestamp('last_requested_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('backfill_request_hash_uq').on(t.requestHash),
    index('backfill_request_status_idx').on(t.status, t.lastRequestedAt),
  ],
);

// ─── tempo real: webhooks (docs/05 §5) ───────────────────────────────────────────────────────────

/** Tópicos públicos entregues por SSE e webhooks (gerados pelos triggers de captura e por publishChange). */
export const REALTIME_TOPICS = [
  'event.status_changed',
  'event.score_changed',
  'event.incident_added',
  'where_to_watch.changed',
  'event.context_published',
  'event.related_content_changed',
] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

/** Filtros opcionais de um webhook; ausente/vazio = sem restrição. */
export type WebhookFilters = { events?: string[]; competitions?: string[]; sports?: string[] };

/**
 * Destino de webhooks de um tenant. O segredo assina o corpo (HMAC-SHA256) e é exibido uma única
 * vez, na criação; fica em claro no banco porque o worker precisa dele para assinar.
 */
export const webhookEndpoint = api.table(
  'webhook_endpoint',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    /** Tópicos assinados; lista vazia = todos os tópicos permitidos pelo plano. */
    topics: text('topics').array().$type<RealtimeTopic[]>().notNull().default([]),
    filters: jsonb('filters').$type<WebhookFilters>().notNull().default({}),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    /**
     * Início da sequência atual de tentativas falhas (nenhuma entrega com sucesso desde então); `null` quando a
     * última tentativa deu certo. O circuit breaker do worker (#360) desativa o endpoint quando passa do prazo.
     */
    failingSince: timestamp('failing_since', { withTimezone: true }),
    /** Quando o circuit breaker desativou o endpoint; some quando o cliente ou a Galaxie reativa. */
    autoDisabledAt: timestamp('auto_disabled_at', { withTimezone: true }),
    /** Último erro na hora da desativação automática (mostrado no portal do cliente). */
    autoDisabledReason: text('auto_disabled_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('webhook_endpoint_tenant_idx').on(t.tenantId, t.active)],
);

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'delivered', 'dead'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/**
 * Uma entrega = uma mudança (`ops.change_feed`) para um endpoint, única por (endpoint, mudança):
 * o enfileiramento é idempotente. Após N falhas a entrega vai para `dead` (DLQ).
 */
export const webhookDelivery = api.table(
  'webhook_delivery',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: 'cascade' }),
    changeId: bigint('change_id', { mode: 'number' }).notNull(),
    topic: text('topic').notNull(),
    /** Corpo enviado, congelado no enfileiramento: retries reenviam exatamente o mesmo JSON. */
    payload: jsonb('payload').notNull(),
    status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    responseCode: integer('response_code'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('webhook_delivery_endpoint_change_uq').on(t.endpointId, t.changeId),
    index('webhook_delivery_due_idx').on(t.status, t.nextRetryAt),
  ],
);

/** Marca d'água do enfileirador de webhooks sobre `ops.change_feed` (uma linha por consumidor). */
export const webhookCursor = api.table('webhook_cursor', {
  name: text('name').primaryKey(),
  lastChangeId: bigint('last_change_id', { mode: 'number' }).notNull().default(0),
  updatedAt: updatedAt(),
});

/**
 * Marca d'água dos consumidores do `ops.change_feed` que rodam dentro da API (uma linha por consumidor; hoje o
 * purge do cache, `cache-purge`). Sobrevive ao restart: as mudanças que caem durante um deploy ainda purgam.
 */
export const changeFeedCursor = api.table('change_feed_cursor', {
  name: text('name').primaryKey(),
  lastChangeId: bigint('last_change_id', { mode: 'number' }).notNull(),
  updatedAt: updatedAt(),
});
