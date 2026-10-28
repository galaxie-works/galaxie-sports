import { index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { tenant } from './api.js';
import { ops } from './ops.js';

// ─── Galaxie Sports Builder: widgets da operadora e chaves publicáveis (docs/05 §1.3) ────────────

/** Tipos de widget que o Builder monta e o pacote de widgets renderiza. */
export const WIDGET_KINDS = ['match_card', 'live_list', 'standings', 'where_to_watch'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** Identidade visual do widget. Cores são strings CSS (`#0a84ff`, `oklch(...)`, `rgb(...)`). */
export interface WidgetTheme {
  primary: string;
  background: string;
  surface: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  /** Raio dos cantos, em px. */
  radius: number;
  fontFamily: string;
  density: 'compact' | 'comfortable';
  mode: 'light' | 'dark';
}

/** Recorte inicial do widget; todos opcionais (o widget pede o que faltar ao app hospedeiro). */
export interface WidgetDefaults {
  competitionId?: string;
  teamId?: string;
  eventId?: string;
  sport?: string;
}

/** Configuração salva do widget (`ops.widget.config`). */
export interface WidgetConfig {
  theme: WidgetTheme;
  /** Locale BCP 47 (`pt-BR`, `es-AR`...). */
  locale: string;
  /** País ISO2 do mercado (`BR`, `AR`...). */
  market: string;
  defaults: WidgetDefaults;
}

/** Widget montado pela operadora no Builder. Salvar de novo incrementa `version`. */
export const widget = ops.table(
  'widget',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<WidgetKind>().notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    config: jsonb('config').$type<WidgetConfig>().notNull(),
    /** Quem criou (e-mail ou id do usuário do painel). */
    createdBy: text('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('widget_tenant_idx').on(t.tenantId, t.archivedAt)],
);

/**
 * Chave publicável (`gs_pk_live_<segredo>`), feita para ficar no código do navegador. Só lê (GET),
 * só das origens em `allowed_origins` e com rate limit próprio. O segredo fica só como sha256
 * (a chave tem 256 bits aleatórios: hash sem sal basta e permite a busca direta).
 */
export const publishableKey = ops.table(
  'publishable_key',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Início da chave, em claro, para a operadora reconhecê-la na lista (`gs_pk_live_AbCd1234`). */
    prefix: text('prefix').notNull(),
    /** sha256 da chave completa, em hex. */
    keyHash: text('key_hash').notNull(),
    /**
     * `live` (`gs_pk_live_`, só origens públicas) ou `test` (`gs_pk_test_`, só localhost/127.0.0.1/[::1]).
     */
    env: text('env').$type<'live' | 'test'>().notNull().default('live'),
    /** Origens aceitas (`https://app.exemplo.com`, `https://*.exemplo.com`). */
    allowedOrigins: text('allowed_origins').array().notNull(),
    /** Restringe a chave a um widget; null = qualquer widget do tenant. Apagar o widget apaga a chave. */
    widgetId: uuid('widget_id').references(() => widget.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('publishable_key_hash_uq').on(t.keyHash),
    index('publishable_key_tenant_idx').on(t.tenantId),
  ],
);
