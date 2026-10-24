import { date, index, jsonb, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

/** included = vem no plano · addon = pacote adicional pago à parte. */
export const LINEUP_ACCESS = ['included', 'addon'] as const;
export type LineupAccess = (typeof LINEUP_ACCESS)[number];

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
export type LineupProposedChange = Record<string, unknown> & { removed?: boolean; seen_at?: string };

const reviewColumns = () => ({
  reviewStatus: text('review_status').$type<LineupReviewStatus>().notNull().default('draft'),
  sources: jsonb('sources').$type<LineupSource[]>().notNull().default([]),
  proposedChange: jsonb('proposed_change').$type<LineupProposedChange>(),
  /** Quem revisou por último (handle do painel). */
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  /** Última vez que a pesquisa (ou a operadora) confirmou o item. */
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
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
    logoAssetId: uuid('logo_asset_id').references(() => asset.id),
    /** Mesmo serviço que uma entrada da biblioteca de emissoras (streaming). */
    broadcasterId: text('broadcaster_id').references(() => broadcaster.id, { onDelete: 'set null' }),
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
    url: text('url'),
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
    ...reviewColumns(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.serviceId] }),
    index('plan_service_service_idx').on(t.serviceId),
  ],
);
