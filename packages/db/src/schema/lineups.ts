import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { asset } from './core.js';
import { broadcaster, enrich } from './enrich.js';

// ─── Grade de canais e ofertas das operadoras e streamings (onde assistir, elo plataforma → plano) ──
//
// Montada por nós a partir das grades e ofertas publicadas pelas próprias operadoras (pesquisa com IA
// e fonte citada, job `lineups-research`). Tudo entra como `draft` e só vai à API pública depois de
// aprovado no painel. Os nomes reais vivem só no banco: o repositório não nomeia operadoras.

/**
 * pay_tv_operator = TV paga (cabo, satélite, IPTV) · vmvpd = TV paga pela internet (grade linear) ·
 * telco_bundle = combo de telecom (internet/celular com TV ou streaming) · streaming = serviço OTT.
 */
export const PLATFORM_KINDS = ['pay_tv_operator', 'vmvpd', 'telco_bundle', 'streaming'] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];

/** draft = da pesquisa, não aparece · reviewed = conferido · approved = publicado · rejected = descartado. */
export const LINEUP_REVIEW_STATUSES = ['draft', 'reviewed', 'approved', 'rejected'] as const;
export type LineupReviewStatus = (typeof LINEUP_REVIEW_STATUSES)[number];

/**
 * included = vem no plano · addon = pacote adicional pago à parte · unverified = a pesquisa viu, mas sem
 * prova oficial e específica do plano: nunca sai na leitura pública (nem como incluso, nem como adicional).
 */
export const LINEUP_ACCESS = ['included', 'addon', 'unverified'] as const;
export type LineupAccess = (typeof LINEUP_ACCESS)[number];

/**
 * Nível da fonte pelo domínio final: official = site da plataforma ou do grupo · comparator = comparador
 * de planos · press = imprensa (ou site de outra emissora) · other = outro site · discarded = documento
 * de terceiros, loja de app ou rede social.
 */
export const LINEUP_SOURCE_TIERS = ['official', 'comparator', 'press', 'other', 'discarded'] as const;
export type LineupSourceTier = (typeof LINEUP_SOURCE_TIERS)[number];

/** pass = a checagem passou · fail = falhou · skip = não se aplica ou não deu para checar. */
export type LineupCheckResult = 'pass' | 'fail' | 'skip';

/**
 * Resultado do validador determinístico (depois da IA) para um plano ou vínculo. Só `verified` vale como
 * prova: preço cheio no plano, `included` no vínculo.
 */
export interface LineupVerification {
  /** URL escrita pelo modelo (pode ser o redirecionamento do grounding, que expira). */
  source_url: string | null;
  /** URL final depois do redirecionamento; null = não deu para seguir. */
  final_url: string | null;
  final_host: string | null;
  tier: LineupSourceTier | null;
  /** Trecho da fonte citado pelo modelo. */
  excerpt: string | null;
  checks: {
    /** O redirecionamento do grounding foi seguido (skip = a URL já era a final). */
    redirect: LineupCheckResult;
    /** A fonte é oficial (site da plataforma ou do grupo). */
    official: LineupCheckResult;
    /** O trecho contém o dado (o número do preço, o nome do canal ou do streaming). */
    excerpt: LineupCheckResult;
    /** O trecho cita o plano (ou a URL final é a página dele). */
    plan_specific: LineupCheckResult;
    /** O mesmo trecho não foi usado em outro plano da plataforma (fail = reaproveitado). */
    not_reused: LineupCheckResult;
    /** Preço: é o cheio de lista, não o promocional (skip fora do preço). */
    list_price?: LineupCheckResult;
    /** Preço: moeda do país (skip fora do preço). */
    currency?: LineupCheckResult;
    /** Streaming: o trecho diz que vem incluso (skip nos canais). */
    included?: LineupCheckResult;
    /** Plano listado na etapa 1 que voltou com detalhe na etapa 2 (fail = plano faltando). */
    details?: LineupCheckResult;
    /** A página oficial lida do nosso lado confirma o item. */
    page?: LineupCheckResult;
  };
  verified: boolean;
  /** O que a IA afirmou e não foi aceito (ex.: o preço sem prova), para a revisão. */
  claimed?: { price_amount?: number | null; currency?: string | null };
  /** Todos os preços vistos do plano, com fonte e data; o escolhido é o oficial provado mais recente. */
  prices?: LineupPriceObservation[];
  /** Mais de um valor entre os preços vistos. */
  price_conflict?: boolean;
  /** Página oficial lida do nosso lado (proveniência da grade). */
  page?: LineupPageRef;
  checked_at: string;
}

/** Um preço visto para o plano (pesquisa ou página oficial). */
export interface LineupPriceObservation {
  amount: number;
  currency: string | null;
  /** research = pesquisa com IA · page = página oficial lida do nosso lado · operator = curadoria. */
  origin: 'research' | 'page' | 'operator';
  source_url: string | null;
  tier: LineupSourceTier | null;
  /** Data da fonte (YYYY-MM ou YYYY-MM-DD), se conhecida; senão a da leitura. */
  source_date: string | null;
  seen_at: string;
  /** Oficial, específico do plano, cheio de lista e na moeda do país. */
  verified: boolean;
}

/** Página oficial lida (proveniência): URL, data da leitura, hash do conteúdo e como foi lida. */
export interface LineupPageRef {
  url: string;
  fetched_at: string;
  hash: string;
  via: LineupPageVia;
}

/** static = HTML · embedded_json = JSON embutido na página · render = navegador headless. */
export const LINEUP_PAGE_VIAS = ['static', 'embedded_json', 'render'] as const;
export type LineupPageVia = (typeof LINEUP_PAGE_VIAS)[number];

/**
 * ok = lida · robots = o robots.txt não permite · blocked = login, formulário, captcha ou paywall (não
 * burlamos) · off_domain = redirecionou para fora dos domínios oficiais · needs_render = o conteúdo só
 * aparece com JavaScript e não há navegador · error = falha de rede ou HTTP.
 */
export const LINEUP_PAGE_STATUSES = [
  'ok',
  'robots',
  'blocked',
  'off_domain',
  'needs_render',
  'error',
] as const;
export type LineupPageStatus = (typeof LINEUP_PAGE_STATUSES)[number];

/** Conteúdo extraído de uma página: o texto e, quando renderizada, as seções abertas (a grade de cada plano). */
export interface LineupPageContent {
  text: string;
  sections: { label: string | null; text: string }[];
}

/** Fonte de um item da grade. `url` nulo só para dado informado pela operadora ou editorial. */
export interface LineupSource {
  url: string | null;
  /** ISO 8601: quando a fonte foi vista (pesquisa) ou o dado foi informado. */
  seen_at: string;
  /** research (padrão) | operator (informado pela operadora) | editorial */
  kind?: 'research' | 'operator' | 'editorial';
  /** Rótulo legível (ex.: "informado pela operadora"). */
  note?: string;
  /** Pedido de revisão que originou o dado (kind = operator). */
  request_id?: string;
}

/**
 * Mudança encontrada pela pesquisa num item já revisado/aprovado (o item não volta a rascunho): os
 * campos novos ficam aqui até alguém aprovar (aplica) ou descartar. `removed` = não foi mais visto.
 */
export type LineupProposedChange = Record<string, unknown> & {
  removed?: boolean;
  seen_at?: string;
  /**
   * Edição manual do painel esperando aprovação: quem editou, quando e a URL da fonte informada. A pesquisa
   * não a sobrescreve; aprovar aplica e marca os campos em `manual_fields`.
   */
  manual?: LineupManualEdit;
};

/** Autor de uma edição manual da grade. */
export interface LineupManualEdit {
  by: string;
  at: string;
  /** URL da fonte informada no painel (vira fonte `editorial` do item ao aprovar). */
  source_url?: string | null;
}

/**
 * Campos editados à mão no painel (Ajustes → Grades e ofertas), com quem editou e quando: a pesquisa
 * seguinte não os sobrescreve (nem no rascunho, nem como mudança proposta). Chaves = campos da proposta
 * (`name`, `priceAmount`, `access`...); `created` = item criado à mão; `removed` = vínculo tirado do plano
 * à mão (fica `rejected`, e a pesquisa não o traz de volta). Equivalente, para a grade, do
 * `semantic.review_override` da revisão semântica.
 */
export type LineupManualFields = Record<string, { by: string; at: string }>;

const reviewColumns = () => ({
  reviewStatus: text('review_status').$type<LineupReviewStatus>().notNull().default('draft'),
  sources: jsonb('sources').$type<LineupSource[]>().notNull().default([]),
  proposedChange: jsonb('proposed_change').$type<LineupProposedChange>(),
  /** Quem revisou por último (handle do painel). */
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  /** Última vez que a pesquisa (ou a operadora) confirmou o item. */
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  manualFields: jsonb('manual_fields').$type<LineupManualFields>().notNull().default({}),
});

/** Operadora de TV paga, vMVPD, combo de telecom ou streaming num país. */
export const platform = enrich.table(
  'platform',
  {
    id: pkUuidV7(),
    /** `<iso2>-<nome normalizado>`, único. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<PlatformKind>().notNull(),
    /** ISO2. */
    country: text('country').notNull(),
    website: text('website'),
    /**
     * Domínios oficiais além do site (o do grupo, o da loja própria): fonte destes domínios conta como
     * oficial no validador da pesquisa. Hosts, sem esquema (`grupo.exemplo`, `loja.exemplo/tv`).
     */
    officialDomains: text('official_domains')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    logoAssetId: uuid('logo_asset_id').references(() => asset.id),
    /**
     * Logo enviado no painel (`setCustomLogo`): vale no lugar do `logo_asset_id` (que a busca de logos
     * regrava). O anterior fica em `enrich.logo_upload`, para voltar.
     */
    customLogoAssetId: uuid('custom_logo_asset_id').references(() => asset.id),
    /** Mesmo serviço que uma entrada da biblioteca de emissoras (streaming). */
    broadcasterId: text('broadcaster_id').references(() => broadcaster.id, { onDelete: 'set null' }),
    /**
     * Páginas oficiais de planos e ofertas (a da lista de planos e, se o site tiver, a de cada plano),
     * descobertas uma vez (busca curta) e lidas do nosso lado na pesquisa da grade.
     */
    planPages: text('plan_pages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Hash das páginas de planos na última extração com IA: página igual na revisita não chama o modelo.
     */
    planPagesHash: text('plan_pages_hash'),
    planPagesExtractedAt: timestamp('plan_pages_extracted_at', { withTimezone: true }),
    ...reviewColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('platform_slug_uq').on(t.slug),
    index('platform_country_idx').on(t.country, t.kind),
    index('platform_broadcaster_idx').on(t.broadcasterId),
  ],
);

/** Plano (pacote) de uma plataforma, com preço em texto como publicado e a vigência. */
export const platformPlan = enrich.table(
  'platform_plan',
  {
    id: pkUuidV7(),
    platformId: uuid('platform_id')
      .notNull()
      .references(() => platform.id, { onDelete: 'cascade' }),
    /** Nome normalizado, único na plataforma. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    country: text('country').notNull(),
    /** Preço como a operadora publica (ex.: "R$ 99,90/mês"); sem conversão. */
    priceText: text('price_text'),
    /** Preço mensal cheio de lista (sem o promocional do 1º mês); só com fonte oficial. */
    priceAmount: numeric('price_amount', { precision: 12, scale: 2, mode: 'number' }),
    /** ISO 4217 da moeda do país (BRL, ARS, CLP, COP, PEN, UYU, MXN; USD no Equador e no Panamá). */
    priceCurrency: text('price_currency'),
    url: text('url'),
    /** Checagens do validador da pesquisa (preço e prova do plano). */
    verification: jsonb('verification').$type<LineupVerification>(),
    ...reviewColumns(),
    /** YYYY-MM-DD (inclusive); null = sem limite. */
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('platform_plan_slug_uq').on(t.platformId, t.slug),
    index('platform_plan_country_idx').on(t.country),
    index('platform_plan_seen_idx').on(t.seenAt),
  ],
);

/** Canal (entrada da biblioteca de emissoras) na grade de um plano. */
export const planChannel = enrich.table(
  'plan_channel',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => platformPlan.id, { onDelete: 'cascade' }),
    /** Id da biblioteca (enrich.broadcaster.id). */
    channelId: text('channel_id')
      .notNull()
      .references(() => broadcaster.id, { onDelete: 'cascade' }),
    access: text('access').$type<LineupAccess>().notNull(),
    /** Checagens do validador da pesquisa. */
    verification: jsonb('verification').$type<LineupVerification>(),
    ...reviewColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.channelId] }),
    index('plan_channel_channel_idx').on(t.channelId),
  ],
);

/** Streaming (entrada da biblioteca de emissoras) incluso num plano. */
export const planService = enrich.table(
  'plan_service',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => platformPlan.id, { onDelete: 'cascade' }),
    /** Id da biblioteca (enrich.broadcaster.id). */
    serviceId: text('service_id')
      .notNull()
      .references(() => broadcaster.id, { onDelete: 'cascade' }),
    access: text('access').$type<LineupAccess>().notNull(),
    /** Checagens do validador da pesquisa. */
    verification: jsonb('verification').$type<LineupVerification>(),
    ...reviewColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.serviceId] }),
    index('plan_service_service_idx').on(t.serviceId),
  ],
);

/** service = streaming ou pacote (Premiere) · channel = canal avulso (ESPN 6). */
export const ADDON_KINDS = ['service', 'channel'] as const;
export type AddonKind = (typeof ADDON_KINDS)[number];

/**
 * Complemento da plataforma: serviço ou canal que qualquer plano contrata à parte, com preço. É da
 * plataforma, não do plano (o Premiere incluso num plano é complemento pago nos outros). O mesmo serviço
 * pode ter várias ofertas (mensal e com fidelidade): uma linha por oferta.
 */
export const platformAddon = enrich.table(
  'platform_addon',
  {
    id: pkUuidV7(),
    platformId: uuid('platform_id')
      .notNull()
      .references(() => platform.id, { onDelete: 'cascade' }),
    /** `<ref>[-<canal>][-f<meses>]`, único na plataforma. */
    slug: text('slug').notNull(),
    kind: text('kind').$type<AddonKind>().notNull(),
    /** Id da biblioteca (enrich.broadcaster.id). */
    refId: text('ref_id')
      .notNull()
      .references(() => broadcaster.id, { onDelete: 'cascade' }),
    /** Canal da entrada, quando o complemento é um canal numerado ("ESPN 6"). */
    channel: text('channel'),
    /** Nome como a plataforma publica ("Premiere Fidelidade"). */
    name: text('name').notNull(),
    priceAmount: numeric('price_amount', { precision: 12, scale: 2, mode: 'number' }),
    priceCurrency: text('price_currency'),
    priceText: text('price_text'),
    /** Fidelidade em meses (null = mensal, sem fidelidade). */
    commitmentMonths: integer('commitment_months'),
    url: text('url'),
    verification: jsonb('verification').$type<LineupVerification>(),
    ...reviewColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('platform_addon_slug_uq').on(t.platformId, t.slug),
    index('platform_addon_ref_idx').on(t.refId),
  ],
);

/**
 * Página oficial lida do nosso lado (grade de canais e inclusos de cada plano): cache por URL com
 * validade e proveniência (data da leitura, hash do conteúdo). Mudou o hash na revisita, a grade vira
 * mudança para revisar.
 */
export const lineupPage = enrich.table(
  'lineup_page',
  {
    url: text('url').primaryKey(),
    platformId: uuid('platform_id').references(() => platform.id, { onDelete: 'set null' }),
    status: text('status').$type<LineupPageStatus>().notNull(),
    via: text('via').$type<LineupPageVia>(),
    httpStatus: integer('http_status'),
    finalUrl: text('final_url'),
    contentHash: text('content_hash'),
    previousHash: text('previous_hash'),
    hashChangedAt: timestamp('hash_changed_at', { withTimezone: true }),
    /** Texto e seções extraídos (para reaproveitar dentro da validade sem buscar de novo). */
    content: jsonb('content').$type<LineupPageContent>(),
    error: text('error'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('lineup_page_platform_idx').on(t.platformId)],
);

/** Entidade que recebe logo enviado no painel: plataforma da grade ou entrada da biblioteca de emissoras. */
export const LOGO_UPLOAD_TARGETS = ['platform', 'broadcaster'] as const;
export type LogoUploadTarget = (typeof LOGO_UPLOAD_TARGETS)[number];

/**
 * Histórico dos logos enviados no painel: cada envio liga o asset novo em `custom_logo_asset_id` e guarda o
 * que estava antes (null = sem logo do painel, vale o da origem), para voltar. Nada é apagado: os arquivos
 * ficam no storage (chave pelo hash) e os assets em core.asset.
 */
export const logoUpload = enrich.table(
  'logo_upload',
  {
    id: pkUuidV7(),
    targetType: text('target_type').$type<LogoUploadTarget>().notNull(),
    /** uuid da plataforma ou id da biblioteca de emissoras. */
    targetId: text('target_id').notNull(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id),
    previousAssetId: uuid('previous_asset_id').references(() => asset.id),
    /** Quem enviou (e-mail do admin). */
    uploadedBy: text('uploaded_by').notNull(),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertedBy: text('reverted_by'),
    createdAt: createdAt(),
  },
  (t) => [index('logo_upload_target_idx').on(t.targetType, t.targetId, t.createdAt)],
);
