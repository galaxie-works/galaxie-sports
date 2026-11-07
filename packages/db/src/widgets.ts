/**
 * Galaxie Sports Builder: widgets salvos pela operadora e chaves publicáveis (docs/05 §1.3).
 *
 * A chave publicável vai no código do navegador, então não é segredo de verdade: o que a protege é
 * a lista de origens, o escopo só de leitura e o rate limit próprio na API. O banco guarda só o
 * sha256 da chave; o texto puro aparece uma única vez, no retorno de `createPublishableKey`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { recordKeyEvent } from './key-events.js';
import {
  publishableKey,
  tenant,
  widget,
  WIDGET_KINDS,
  widgetTheme,
  type ApiModule,
  type ApiPlan,
  type WidgetConfig,
  type WidgetKind,
  type WidgetTheme,
} from './schema/index.js';

export type { WidgetConfig, WidgetDefaults, WidgetKind, WidgetTheme } from './schema/index.js';

export type Widget = typeof widget.$inferSelect;

/** Módulos que cada tipo de widget consome. Uma chave presa a um widget só alcança estes módulos. */
export const WIDGET_KIND_MODULES: Record<WidgetKind, readonly ApiModule[]> = {
  match_card: ['core_data', 'where_to_watch'],
  match_timeline: ['core_data'],
  live_list: ['core_data'],
  score_ticker: ['core_data'],
  standings: ['core_data'],
  where_to_watch: ['core_data', 'where_to_watch'],
  ai_context: ['core_data', 'live_intelligence'],
  match_stakes: ['core_data'],
  related_videos: ['core_data', 'related_content'],
  head_to_head: ['core_data'],
  team_schedule: ['core_data'],
  team_card: ['core_data'],
  race_result: ['core_data'],
  race_weekend: ['core_data'],
  season_calendar: ['core_data'],
  athlete_profile: ['core_data'],
  fight_card: ['core_data'],
  equestrian_results: ['core_data'],
  equestrian_ranking: ['core_data'],
  equestrian_calendar: ['core_data'],
  rider_profile: ['core_data'],
  horse_profile: ['core_data'],
  medal_table: ['core_data', 'multisport'],
  country_today: ['core_data', 'multisport'],
  games_schedule: ['core_data', 'multisport'],
  country_athletes: ['core_data', 'multisport'],
  medal_history: ['core_data', 'multisport'],
  champions_gallery: ['core_data'],
  competition_leaders: ['core_data'],
  countdown: ['core_data', 'where_to_watch'],
  team_squad: ['core_data'],
  player_profile: ['core_data'],
  lineups: ['core_data'],
  team_stats: ['core_data'],
};

export function isWidgetKind(value: unknown): value is WidgetKind {
  return typeof value === 'string' && (WIDGET_KINDS as readonly string[]).includes(value);
}

// ─── widgets ────────────────────────────────────────────────────────────────────────────────────

/** Widgets ativos (não arquivados) do tenant, do mais recente ao mais antigo. */
export async function listWidgets(db: Database, tenantId: string): Promise<Widget[]> {
  return db
    .select()
    .from(widget)
    .where(and(eq(widget.tenantId, tenantId), isNull(widget.archivedAt)))
    .orderBy(desc(widget.updatedAt), desc(widget.id));
}

/** Widget pelo id, arquivado ou não (quem chama confere `tenantId` e `archivedAt`); null se não existe. */
export async function getWidget(db: Database, id: string): Promise<Widget | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(widget).where(eq(widget.id, id)).limit(1);
  return row ?? null;
}

export interface SaveWidgetInput {
  tenantId: string;
  /** Ausente = cria; presente = atualiza (e incrementa `version`). */
  id?: string;
  kind: WidgetKind;
  name: string;
  config: WidgetConfig;
  /** Autor; só é gravado na criação. */
  createdBy: string;
}

/**
 * Cria ou atualiza um widget. Na atualização, `version` sobe 1 e `created_by` não muda.
 * Lança erro se o widget não existe, é de outro tenant ou está arquivado.
 */
export async function saveWidget(db: Database, input: SaveWidgetInput): Promise<Widget> {
  if (!isWidgetKind(input.kind)) throw new Error(`Tipo de widget inválido: ${String(input.kind)}`);
  const name = input.name.trim();
  if (!name) throw new Error('Nome do widget obrigatório.');

  const config = await withBrandTheme(db, input.tenantId, input.config);

  if (!input.id) {
    const [created] = await db
      .insert(widget)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        name,
        config,
        createdBy: input.createdBy,
      })
      .returning();
    return created!;
  }

  const [updated] = UUID_RE.test(input.id)
    ? await db
        .update(widget)
        .set({
          kind: input.kind,
          name,
          config,
          version: sql`${widget.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(widget.id, input.id), eq(widget.tenantId, input.tenantId), isNull(widget.archivedAt)))
        .returning()
    : [];
  if (!updated) throw new Error(`Widget ${input.id} não encontrado para este tenant.`);
  return updated;
}

/**
 * Arquiva o widget (some da lista) e, na mesma transação, revoga as chaves publicáveis presas a ele:
 * elas já paravam de valer, e assim o painel também as mostra como revogadas. false se não havia o que
 * arquivar.
 */
export async function archiveWidget(db: Database, tenantId: string, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  return db.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx
      .update(widget)
      .set({ archivedAt: now })
      .where(and(eq(widget.id, id), eq(widget.tenantId, tenantId), isNull(widget.archivedAt)))
      .returning({ id: widget.id });
    if (rows.length === 0) return false;
    const revoked = await tx
      .update(publishableKey)
      .set({ revokedAt: now })
      .where(
        and(
          eq(publishableKey.widgetId, id),
          eq(publishableKey.tenantId, tenantId),
          isNull(publishableKey.revokedAt),
        ),
      )
      .returning({ id: publishableKey.id, prefix: publishableKey.prefix });
    for (const k of revoked)
      await recordKeyEvent(tx, {
        tenantId,
        keyKind: 'publishable',
        keyId: k.id,
        prefix: k.prefix,
        action: 'revoked',
        actor: 'widget',
        detail: { widgetId: id, reason: 'widget arquivado' },
      });
    return true;
  });
}

// ─── temas da marca ─────────────────────────────────────────────────────────────────────────────

export type WidgetBrandTheme = typeof widgetTheme.$inferSelect;

/** Tema da marca com quantos widgets ativos o seguem. */
export interface WidgetBrandThemeSummary extends WidgetBrandTheme {
  widgetCount: number;
}

/** Máximo de temas da marca por tenant. */
export const MAX_WIDGET_THEMES_PER_TENANT = 50;

/** O widget aponta para um tema da marca que não existe (apagado ou de outro tenant). */
export class BrandThemeNotFoundError extends Error {
  constructor(id: string) {
    super(`Tema da marca ${id} não encontrado para este tenant.`);
    this.name = 'BrandThemeNotFoundError';
  }
}

/** Já existe um tema da marca com este nome no tenant. */
export class BrandThemeNameTakenError extends Error {
  constructor(name: string) {
    super(`Já existe um tema da marca chamado "${name}".`);
    this.name = 'BrandThemeNameTakenError';
  }
}

/** O tenant chegou ao limite de temas da marca. */
export class BrandThemeLimitError extends Error {
  constructor() {
    super(`Limite de ${MAX_WIDGET_THEMES_PER_TENANT} temas da marca por tenant.`);
    this.name = 'BrandThemeLimitError';
  }
}

/** Tema efetivo: o da marca com os ajustes do widget por cima (só as chaves conhecidas). */
export function applyThemeOverrides(base: WidgetTheme, overrides?: Partial<WidgetTheme> | null): WidgetTheme {
  const out = { ...base };
  if (!overrides) return out;
  for (const key of Object.keys(base) as (keyof WidgetTheme)[]) {
    const v = overrides[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** Só os ajustes (chaves conhecidas) que diferem do tema da marca. */
function overridesAgainst(base: WidgetTheme, overrides?: Partial<WidgetTheme> | null): Partial<WidgetTheme> {
  const out: Partial<WidgetTheme> = {};
  for (const key of Object.keys(base) as (keyof WidgetTheme)[]) {
    const v = overrides?.[key];
    if (v !== undefined && v !== base[key]) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

/**
 * Com `brandThemeId`, recalcula o tema efetivo a partir do tema da marca (o banco manda, não o navegador)
 * e guarda só os ajustes que diferem dele. Lança `BrandThemeNotFoundError` se o tema não é do tenant.
 */
async function withBrandTheme(db: Database, tenantId: string, config: WidgetConfig): Promise<WidgetConfig> {
  const { brandThemeId, themeOverrides, ...rest } = config;
  if (!brandThemeId) return rest;
  const brand = await getWidgetTheme(db, tenantId, brandThemeId);
  if (!brand) throw new BrandThemeNotFoundError(brandThemeId);
  const overrides = overridesAgainst(brand.theme, themeOverrides);
  return {
    ...rest,
    theme: applyThemeOverrides(brand.theme, overrides),
    brandThemeId: brand.id,
    ...(Object.keys(overrides).length ? { themeOverrides: overrides } : {}),
  };
}

/** Temas da marca do tenant, por nome, com a contagem de widgets ativos que seguem cada um. */
export async function listWidgetThemes(db: Database, tenantId: string): Promise<WidgetBrandThemeSummary[]> {
  const themes = await db
    .select()
    .from(widgetTheme)
    .where(eq(widgetTheme.tenantId, tenantId))
    .orderBy(asc(widgetTheme.name));
  if (!themes.length) return [];
  const counts = await db
    .select({ id: sql<string>`${widget.config}->>'brandThemeId'`, n: sql<number>`count(*)::int` })
    .from(widget)
    .where(
      and(eq(widget.tenantId, tenantId), isNull(widget.archivedAt), sql`${widget.config} ? 'brandThemeId'`),
    )
    .groupBy(sql`${widget.config}->>'brandThemeId'`);
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return themes.map((t) => ({ ...t, widgetCount: byId.get(t.id) ?? 0 }));
}

/** Tema da marca do tenant, ou null. */
export async function getWidgetTheme(
  db: Database,
  tenantId: string,
  id: string,
): Promise<WidgetBrandTheme | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db
    .select()
    .from(widgetTheme)
    .where(and(eq(widgetTheme.id, id), eq(widgetTheme.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

export interface SaveWidgetThemeInput {
  tenantId: string;
  /** Ausente = cria; presente = atualiza. */
  id?: string;
  name: string;
  theme: WidgetTheme;
  createdBy: string;
}

export interface SaveWidgetThemeResult {
  theme: WidgetBrandTheme;
  /** Widgets regravados com o tema novo (sobem uma versão). */
  widgetsUpdated: number;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  ((err as { code?: string }).code === '23505' ||
    (err as { cause?: { code?: string } }).cause?.code === '23505');

/**
 * Cria ou atualiza um tema da marca. Na atualização, na mesma transação, regrava o tema efetivo de todos
 * os widgets do tenant ligados a ele (tema da marca + ajustes de cada widget) e sobe a versão deles: o
 * embed, o registry e a prévia passam a desenhar o tema novo sem que a operadora salve widget por widget.
 */
export async function saveWidgetTheme(
  db: Database,
  input: SaveWidgetThemeInput,
): Promise<SaveWidgetThemeResult> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Nome do tema obrigatório.');
  try {
    return await db.transaction(async (tx) => {
      if (!input.id) {
        // trava o tenant antes de contar: dois "criar" ao mesmo tempo não passam do limite
        await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, input.tenantId)).for('update');
        const [{ n } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(widgetTheme)
          .where(eq(widgetTheme.tenantId, input.tenantId));
        if (n >= MAX_WIDGET_THEMES_PER_TENANT) throw new BrandThemeLimitError();
        const [created] = await tx
          .insert(widgetTheme)
          .values({ tenantId: input.tenantId, name, theme: input.theme, createdBy: input.createdBy })
          .returning();
        return { theme: created!, widgetsUpdated: 0 };
      }
      const [updated] = UUID_RE.test(input.id)
        ? await tx
            .update(widgetTheme)
            .set({ name, theme: input.theme, updatedAt: new Date() })
            .where(and(eq(widgetTheme.id, input.id), eq(widgetTheme.tenantId, input.tenantId)))
            .returning()
        : [];
      if (!updated) throw new BrandThemeNotFoundError(input.id);
      const linked = await tx
        .select({ id: widget.id, config: widget.config })
        .from(widget)
        .where(
          and(eq(widget.tenantId, input.tenantId), sql`${widget.config}->>'brandThemeId' = ${updated.id}`),
        );
      let widgetsUpdated = 0;
      for (const w of linked) {
        // ajuste que ficou igual ao tema novo deixa de ser ajuste (senão a chave para de seguir o tema)
        const overrides = overridesAgainst(updated.theme, w.config.themeOverrides);
        const theme = applyThemeOverrides(updated.theme, overrides);
        const { themeOverrides: _old, ...rest } = w.config;
        const config: WidgetConfig = {
          ...rest,
          theme,
          ...(Object.keys(overrides).length ? { themeOverrides: overrides } : {}),
        };
        if (JSON.stringify(config) === JSON.stringify(w.config)) continue;
        const visual = JSON.stringify(theme) !== JSON.stringify(w.config.theme);
        await tx
          .update(widget)
          .set({
            config,
            // só o que muda o desenho sobe versão (o embed e o registry usam a versão)
            ...(visual ? { version: sql`${widget.version} + 1`, updatedAt: new Date() } : {}),
          })
          .where(eq(widget.id, w.id));
        if (visual) widgetsUpdated += 1;
      }
      return { theme: updated, widgetsUpdated };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new BrandThemeNameTakenError(name);
    throw err;
  }
}

/**
 * Apaga o tema da marca. Os widgets ligados a ele ficam com o visual que tinham (o tema efetivo já está
 * gravado neles) e passam a ter tema próprio. Devolve quantos widgets foram desligados, ou null se o tema
 * não existe no tenant.
 */
export async function deleteWidgetTheme(db: Database, tenantId: string, id: string): Promise<number | null> {
  if (!UUID_RE.test(id)) return null;
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(widgetTheme)
      .where(and(eq(widgetTheme.id, id), eq(widgetTheme.tenantId, tenantId)))
      .returning({ id: widgetTheme.id });
    if (!removed) return null;
    const linked = await tx
      .select({ id: widget.id, config: widget.config })
      .from(widget)
      .where(and(eq(widget.tenantId, tenantId), sql`${widget.config}->>'brandThemeId' = ${id}`));
    for (const w of linked) {
      const { brandThemeId: _b, themeOverrides: _o, ...config } = w.config;
      await tx
        .update(widget)
        .set({ config, version: sql`${widget.version} + 1`, updatedAt: new Date() })
        .where(eq(widget.id, w.id));
    }
    return linked.length;
  });
}

// ─── chaves publicáveis ─────────────────────────────────────────────────────────────────────────

export const PUBLISHABLE_KEY_PREFIX = 'gs_pk_live_';
/** Publicável de teste: só vale em localhost/127.0.0.1/[::1] (docs/politica-de-chaves.md §1). */
export const PUBLISHABLE_TEST_KEY_PREFIX = 'gs_pk_test_';
/** `gs_pk_<live|test>_` + 32 bytes aleatórios em base64url (43 caracteres). */
const PUBLISHABLE_KEY_RE = /^gs_pk_(live|test)_[A-Za-z0-9_-]{43}$/;
/** Chaves publicáveis ativas (não revogadas) por tenant. */
export const MAX_PUBLISHABLE_KEYS_PER_TENANT = 20;

export type PublishableKeyEnv = 'live' | 'test';

/** Teto de chaves publicáveis ativas do tenant atingido. */
export class PublishableKeyLimitError extends Error {
  constructor() {
    super(
      `O tenant já tem ${MAX_PUBLISHABLE_KEYS_PER_TENANT} chaves publicáveis ativas; revogue as que não usa.`,
    );
    this.name = 'PublishableKeyLimitError';
  }
}
/** Caracteres do segredo exibidos no prefixo (só para a operadora reconhecer a chave). */
const PREFIX_VISIBLE = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formato válido de chave publicável (não diz se ela existe). */
export function isPublishableKey(key: string): boolean {
  return PUBLISHABLE_KEY_RE.test(key.trim());
}

/** Ambiente pelo prefixo (`gs_pk_test_` = teste); null se o formato for inválido. */
export function publishableKeyEnv(key: string): PublishableKeyEnv | null {
  const m = PUBLISHABLE_KEY_RE.exec(key.trim());
  return m ? (m[1] as PublishableKeyEnv) : null;
}

/** sha256 da chave em hex — o que o banco guarda em `key_hash`. */
export function hashPublishableKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

/** Gera uma chave nova: o texto puro, o prefixo visível e o hash. */
export function generatePublishableKey(env: PublishableKeyEnv = 'live'): {
  key: string;
  prefix: string;
  keyHash: string;
} {
  const secret = randomBytes(32).toString('base64url');
  const head = env === 'test' ? PUBLISHABLE_TEST_KEY_PREFIX : PUBLISHABLE_KEY_PREFIX;
  const key = `${head}${secret}`;
  return {
    key,
    prefix: `${head}${secret.slice(0, PREFIX_VISIBLE)}`,
    keyHash: hashPublishableKey(key),
  };
}

/**
 * Normaliza uma origem permitida: `scheme://host[:porta]` em minúsculas, sem barra final. Aceita
 * curinga só no primeiro rótulo e com ao menos dois rótulos depois (`https://*.exemplo.com`).
 * Inválida → null.
 */
export function normalizeAllowedOrigin(pattern: string): string | null {
  const raw = pattern.trim().toLowerCase().replace(/\/+$/, '');
  const wildcard = /^(https?):\/\/\*\.(.+)$/.exec(raw);
  if (wildcard) {
    const rest = normalizeOrigin(`${wildcard[1]}://${wildcard[2]}`);
    if (!rest) return null;
    const host = new URL(rest).hostname;
    // `*.com`, `*.localhost` e IPs não fazem sentido como curinga
    if (host.split('.').length < 2 || /^[\d.]+$/.test(host) || host.startsWith('[')) return null;
    return rest.replace('://', '://*.');
  }
  return normalizeOrigin(raw);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A origem (ou o padrão de origem) é da máquina local: localhost, 127.0.0.1 ou [::1], em qualquer porta. */
export function isLoopbackOrigin(origin: string): boolean {
  const n = normalizeAllowedOrigin(origin);
  if (!n || n.includes('://*.')) return false;
  return LOOPBACK_HOSTS.has(new URL(n).hostname);
}

/** Origem concreta (`Origin` do navegador) normalizada; `null`, caminhos e esquemas não-http → null. */
export function normalizeOrigin(origin: string): string | null {
  try {
    const u = new URL(origin.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || u.username || u.password)
      return null;
    if (u.hostname.includes('*')) return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A origem bate com a lista? Exata (esquema, host e porta) ou por curinga de subdomínio:
 * `https://*.exemplo.com` aceita `https://app.exemplo.com` e `https://a.b.exemplo.com`, mas não
 * `https://exemplo.com` nem `http://app.exemplo.com`.
 */
export function isOriginAllowed(origin: string | null | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  const o = normalizeOrigin(origin);
  if (!o) return false;
  const target = new URL(o);
  for (const pattern of allowed) {
    const p = normalizeAllowedOrigin(pattern);
    if (!p) continue;
    if (!p.includes('://*.')) {
      if (p === o) return true;
      continue;
    }
    const base = new URL(p.replace('://*.', '://'));
    if (base.protocol !== target.protocol || base.port !== target.port) continue;
    if (target.hostname.endsWith(`.${base.hostname}`)) return true;
  }
  return false;
}

export interface CreatePublishableKeyInput {
  tenantId: string;
  name: string;
  allowedOrigins: string[];
  /** Restringe a chave a um widget do mesmo tenant. */
  widgetId?: string | null;
  /** `live` (padrão): origens públicas; `test`: só localhost/127.0.0.1/[::1]. */
  env?: PublishableKeyEnv;
  /** Quem criou, para a auditoria (`panel:<id do usuário>`, `cli:...`). Padrão `panel`. */
  actor?: string;
}

/** Origens que não servem ao ambiente: produção sem localhost, teste só com localhost. */
export function originsOutsideEnv(env: PublishableKeyEnv, origins: readonly string[]): string[] {
  return origins.filter((o) => (env === 'test') !== isLoopbackOrigin(o));
}

/**
 * Cria a chave e devolve o texto puro **só agora** (o banco fica com o sha256). Valida as origens
 * (ao menos uma, e do ambiente: produção sem localhost, teste só com localhost), o teto de
 * `MAX_PUBLISHABLE_KEYS_PER_TENANT` ativas (PublishableKeyLimitError) e, se houver `widgetId`, que o
 * widget é do tenant e está ativo.
 */
export async function createPublishableKey(
  db: Database,
  input: CreatePublishableKeyInput,
): Promise<{ id: string; key: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('Nome da chave obrigatório.');
  const origins: string[] = [];
  for (const o of input.allowedOrigins) {
    const n = normalizeAllowedOrigin(o);
    if (!n) throw new Error(`Origem inválida: "${o}" (use https://app.exemplo.com ou https://*.exemplo.com)`);
    if (!origins.includes(n)) origins.push(n);
  }
  if (!origins.length) throw new Error('Informe ao menos uma origem permitida.');
  const env = input.env ?? 'live';
  const outside = originsOutsideEnv(env, origins);
  if (outside.length)
    throw new Error(
      env === 'test'
        ? `Chave de teste só aceita localhost, 127.0.0.1 ou [::1]: ${outside.join(', ')}`
        : `Chave de produção não aceita localhost (use uma chave de teste): ${outside.join(', ')}`,
    );
  if (input.widgetId) {
    const w = await getWidget(db, input.widgetId);
    if (!w || w.tenantId !== input.tenantId || w.archivedAt)
      throw new Error(`Widget ${input.widgetId} não encontrado para este tenant.`);
  }
  const generated = generatePublishableKey(env);
  return db.transaction(async (tx) => {
    // trava o tenant: duas criações simultâneas não furam o teto
    await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, input.tenantId)).for('update');
    const [active] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(publishableKey)
      .where(and(eq(publishableKey.tenantId, input.tenantId), isNull(publishableKey.revokedAt)));
    if ((active?.n ?? 0) >= MAX_PUBLISHABLE_KEYS_PER_TENANT) throw new PublishableKeyLimitError();
    const [row] = await tx
      .insert(publishableKey)
      .values({
        tenantId: input.tenantId,
        name,
        env,
        prefix: generated.prefix,
        keyHash: generated.keyHash,
        allowedOrigins: origins,
        widgetId: input.widgetId ?? null,
      })
      .returning({ id: publishableKey.id });
    await recordKeyEvent(tx, {
      tenantId: input.tenantId,
      keyKind: 'publishable',
      keyId: row!.id,
      prefix: generated.prefix,
      action: 'issued',
      actor: input.actor ?? 'panel',
      detail: { env, name, ...(input.widgetId ? { widgetId: input.widgetId } : {}) },
    });
    return { id: row!.id, key: generated.key };
  });
}

/** Chave publicável como listada no painel: sem o hash. */
export interface PublishableKeySummary {
  id: string;
  name: string;
  env: PublishableKeyEnv;
  prefix: string;
  allowedOrigins: string[];
  widgetId: string | null;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

const summaryColumns = {
  id: publishableKey.id,
  name: publishableKey.name,
  env: publishableKey.env,
  prefix: publishableKey.prefix,
  allowedOrigins: publishableKey.allowedOrigins,
  widgetId: publishableKey.widgetId,
  createdAt: publishableKey.createdAt,
  revokedAt: publishableKey.revokedAt,
  lastUsedAt: publishableKey.lastUsedAt,
};

/** Todas as chaves do tenant (inclusive revogadas), das mais novas às mais antigas. */
export async function listPublishableKeys(db: Database, tenantId: string): Promise<PublishableKeySummary[]> {
  return db
    .select(summaryColumns)
    .from(publishableKey)
    .where(eq(publishableKey.tenantId, tenantId))
    .orderBy(desc(publishableKey.createdAt), desc(publishableKey.id));
}

/** Revoga a chave (vale na API em até 60 s, o cache da verificação). false se não havia o que revogar. */
export async function revokePublishableKey(
  db: Database,
  tenantId: string,
  id: string,
  actor = 'panel',
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(publishableKey)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(publishableKey.id, id),
          eq(publishableKey.tenantId, tenantId),
          isNull(publishableKey.revokedAt),
        ),
      )
      .returning({ id: publishableKey.id, prefix: publishableKey.prefix });
    if (!row) return false;
    await recordKeyEvent(tx, {
      tenantId,
      keyKind: 'publishable',
      keyId: row.id,
      prefix: row.prefix,
      action: 'revoked',
      actor,
    });
    return true;
  });
}

/** Resultado de uma verificação bem-sucedida: o bastante para a API montar o contexto do tenant. */
export interface VerifiedPublishableKey {
  keyId: string;
  tenantId: string;
  env: PublishableKeyEnv;
  tenant: {
    id: string;
    slug: string;
    plan: ApiPlan;
    modules: ApiModule[];
    markets: string[];
    sports: string[];
    rateLimitPerMinute: number;
    /** Cota diária de produção; null = sem cota. */
    dailyRequestQuota: number | null;
  };
  allowedOrigins: string[];
  /** Widget a que a chave está presa (null = qualquer). */
  widgetId: string | null;
  /** Tipo do widget preso, para a API restringir os módulos (`WIDGET_KIND_MODULES`). */
  widgetKind: WidgetKind | null;
}

/**
 * Verifica a chave pelo sha256. null se o formato é inválido, a chave não existe ou foi revogada,
 * o tenant está suspenso ou o widget a que ela está presa foi arquivado.
 */
export async function verifyPublishableKey(
  db: Database,
  key: string,
): Promise<VerifiedPublishableKey | null> {
  if (!isPublishableKey(key)) return null;
  const [row] = await db
    .select({
      keyId: publishableKey.id,
      env: publishableKey.env,
      revokedAt: publishableKey.revokedAt,
      allowedOrigins: publishableKey.allowedOrigins,
      widgetId: publishableKey.widgetId,
      widgetKind: widget.kind,
      widgetArchivedAt: widget.archivedAt,
      widgetTenantId: widget.tenantId,
      tenant,
    })
    .from(publishableKey)
    .innerJoin(tenant, eq(tenant.id, publishableKey.tenantId))
    .leftJoin(widget, eq(widget.id, publishableKey.widgetId))
    .where(eq(publishableKey.keyHash, hashPublishableKey(key)))
    .limit(1);
  if (!row || row.revokedAt || row.tenant.status !== 'active') return null;
  // trial encerrado: nenhuma chave do tenant vale
  if (row.tenant.trialEndsAt && row.tenant.trialEndsAt <= new Date()) return null;
  // o prefixo vale: o ambiente gravado precisa ser o do prefixo
  if (row.env !== publishableKeyEnv(key)) return null;
  if (row.widgetId && (row.widgetArchivedAt || row.widgetTenantId !== row.tenant.id)) return null;
  return {
    keyId: row.keyId,
    tenantId: row.tenant.id,
    env: row.env,
    tenant: {
      id: row.tenant.id,
      slug: row.tenant.slug,
      plan: row.tenant.plan,
      modules: row.tenant.modules,
      markets: row.tenant.markets,
      sports: row.tenant.sports,
      rateLimitPerMinute: row.tenant.rateLimitPerMinute,
      dailyRequestQuota: row.tenant.dailyRequestQuota,
    },
    allowedOrigins: row.allowedOrigins,
    widgetId: row.widgetId,
    widgetKind: row.widgetId ? (row.widgetKind ?? null) : null,
  };
}

/** Marca o uso da chave (a API chama com throttle; best effort). */
export async function touchPublishableKey(db: Database, id: string, at = new Date()): Promise<void> {
  await db.update(publishableKey).set({ lastUsedAt: at }).where(eq(publishableKey.id, id));
}

/** Origens de todas as chaves ativas — a API usa para responder ao preflight CORS (que não traz chave). */
export async function listActivePublishableOrigins(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ origin: sql<string>`unnest(${publishableKey.allowedOrigins})` })
    .from(publishableKey)
    .where(isNull(publishableKey.revokedAt));
  return rows.map((r) => r.origin);
}
