import { index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { tenant } from './api.js';
import { ops } from './ops.js';

// ─── Galaxie Sports Builder: widgets da operadora e chaves publicáveis (docs/05 §1.3) ────────────

/** Tipos de widget que o Builder monta e o pacote de widgets renderiza. */
export const WIDGET_KINDS = [
  'match_card',
  'match_timeline',
  'live_list',
  'standings',
  'where_to_watch',
  'ai_context',
  'match_stakes',
  'related_videos',
  'head_to_head',
  'team_schedule',
  'race_result',
  'race_weekend',
  'season_calendar',
  'athlete_profile',
  'fight_card',
  'equestrian_results',
  'equestrian_ranking',
  'equestrian_calendar',
  'rider_profile',
  'horse_profile',
  'medal_table',
  'country_today',
  'games_schedule',
  'country_athletes',
  'medal_history',
  'competition_leaders',
  'team_squad',
] as const;
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
  /**
   * Tema efetivo do widget, o que o embed, o registry e a prévia desenham. Com `brandThemeId`, é o tema da
   * marca com `themeOverrides` por cima, regravado a cada mudança no tema da marca (`saveWidgetTheme`).
   */
  theme: WidgetTheme;
  /** Tema da marca do tenant (`ops.widget_theme`) que este widget segue. Ausente = tema só do widget. */
  brandThemeId?: string;
  /** Ajustes só deste widget por cima do tema da marca (só as chaves que diferem). */
  themeOverrides?: Partial<WidgetTheme>;
  /** Locale BCP 47 (`pt-BR`, `es-AR`...). */
  locale: string;
  /** País ISO2 do mercado (`BR`, `AR`...). */
  market: string;
  defaults: WidgetDefaults;
  /** Só na tabela de classificação: legenda e cor de cada faixa (`direct`, `relegation`… → `#rrggbb`). */
  standings?: { showLegend?: boolean; zoneColors?: Record<string, string> };
  /**
   * Só na lista de jogos: só ao vivo, agrupar por campeonato, atualização automática, máximo de jogos e os
   * dados extras de cada linha (logo do campeonato, rodada, estádio, cidade).
   */
  liveList?: {
    liveOnly?: boolean;
    groupByCompetition?: boolean;
    autoRefresh?: boolean;
    limit?: number;
    showCompetitionLogo?: boolean;
    showRound?: boolean;
    showVenue?: boolean;
    showCity?: boolean;
  };
  /** Opções de conteúdo do tipo (`WIDGET_OPTIONS` de @galaxie/widgets): campos liga/desliga, quantidades, filtros. */
  options?: Record<string, string | number | boolean>;
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
 * Tema da marca: a identidade visual que a operadora cria uma vez no Builder e aplica em vários widgets
 * (`config.brandThemeId`). Mudar o tema regrava o tema efetivo de todos os widgets ligados a ele.
 */
export const widgetTheme = ops.table(
  'widget_theme',
  {
    id: pkUuidV7(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    theme: jsonb('theme').$type<WidgetTheme>().notNull(),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('widget_theme_tenant_name_uq').on(t.tenantId, t.name)],
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
