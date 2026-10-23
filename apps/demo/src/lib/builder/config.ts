/**
 * Regras do Builder (puro: servidor, navegador e testes): o que um widget salvo pode conter, os domínios
 * de uma chave publicável e os textos de instalação (comando do shadcn, uso no código e a variável da
 * chave). Tudo o que chega do navegador passa por `parseWidgetInput` e `parseOrigins` no servidor.
 *
 * Só tipos de `@galaxie/db` e a entrada sem React de `@galaxie/widgets` (`/registry`) entram aqui: o
 * módulo vai para o navegador e para rotas do servidor.
 */
import type { WidgetLocale as PackageLocale } from '@galaxie/widgets';
import { toRegistryName } from '@galaxie/widgets/registry';

import type { Locale } from '@/lib/i18n/config';
import { SITE_URL } from '@/lib/site';

import type { WidgetConfig, WidgetDefaults, WidgetEntityType, WidgetKind, WidgetTheme } from './types';

/** Os mesmos de `@galaxie/db` (`WIDGET_KINDS`); o `satisfies` acusa se um tipo sumir de lá. */
export const WIDGET_KINDS = [
  'match_card',
  'live_list',
  'standings',
  'where_to_watch',
] as const satisfies readonly WidgetKind[];

export const isWidgetKind = (v: unknown): v is WidgetKind =>
  typeof v === 'string' && (WIDGET_KINDS as readonly string[]).includes(v);

/** Idiomas do widget (os de `@galaxie/widgets`; o espanhol segue a variante do mercado). */
export const WIDGET_LOCALES = ['pt-BR', 'es', 'en'] as const satisfies readonly PackageLocale[];
export type WidgetLocale = (typeof WIDGET_LOCALES)[number];

/** Idioma da tela da demo → idioma do widget. */
export const toWidgetLocale = (locale: Locale): WidgetLocale => (locale === 'es-AR' ? 'es' : locale);

export const isWidgetLocale = (v: unknown): v is WidgetLocale =>
  typeof v === 'string' && (WIDGET_LOCALES as readonly string[]).includes(v);

/**
 * Entidade padrão que cada tipo aceita, pelas props dos componentes de `@galaxie/widgets` (`eventId`,
 * `competitionId`). O teste confere contra `WIDGET_CATALOG`.
 */
export const ENTITY_TYPES: Record<WidgetKind, readonly WidgetEntityType[]> = {
  match_card: ['event'],
  live_list: ['competition'],
  standings: ['competition'],
  where_to_watch: ['event'],
};

const STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** Fontes do editor (pilhas CSS): a dos temas prontos e famílias comuns do Google Fonts. */
export const FONT_FAMILIES = [
  `Inter, ${STACK}`,
  `Roboto, ${STACK}`,
  `Poppins, ${STACK}`,
  `Montserrat, ${STACK}`,
  `"Open Sans", ${STACK}`,
  `Lato, ${STACK}`,
  STACK,
];

/** Rótulo de uma pilha de fontes: a primeira família (`"Open Sans", ...` → `Open Sans`). */
export const fontLabel = (stack: string) =>
  stack
    .split(',')[0]!
    .trim()
    .replace(/^["']|["']$/g, '');

/** Mercados oferecidos quando o plano não restringe (o plano com mercados mostra só os dele). */
export const DEFAULT_MARKETS = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'PY', 'EC', 'US', 'ES', 'PT'];

/** Mercados que o tenant pode escolher (o primeiro é o padrão de um widget novo). */
export const marketsFor = (tenantMarkets: string[]) =>
  tenantMarkets.length ? tenantMarkets : DEFAULT_MARKETS;

export const RADIUS_MAX = 24;
export const NAME_MAX = 80;
export const MAX_ORIGINS = 20;

/** Variável de ambiente da chave publicável no app da operadora (o registry pede para criá-la). */
export { PUBLISHABLE_KEY_ENV } from '@galaxie/widgets/registry';

const HEX = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS = ['primary', 'background', 'surface', 'foreground', 'mutedForeground', 'border'] as const;

/** Tema válido ou null (cores `#rrggbb`, raio 0–24, fonte da lista, densidade e modo conhecidos). */
export function parseTheme(raw: unknown): WidgetTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  for (const k of COLOR_KEYS) if (typeof t[k] !== 'string' || !HEX.test(t[k])) return null;
  const radius = Number(t.radius);
  if (!Number.isFinite(radius) || radius < 0 || radius > RADIUS_MAX) return null;
  // Mesma regra do gerador do registry: texto curto, sem nada que feche a declaração CSS.
  if (typeof t.fontFamily !== 'string' || t.fontFamily.length > 200 || /[;{}<>]/.test(t.fontFamily))
    return null;
  if (t.density !== 'compact' && t.density !== 'comfortable') return null;
  if (t.mode !== 'light' && t.mode !== 'dark') return null;
  const color = (k: (typeof COLOR_KEYS)[number]) => (t[k] as string).toLowerCase();
  return {
    primary: color('primary'),
    background: color('background'),
    surface: color('surface'),
    foreground: color('foreground'),
    mutedForeground: color('mutedForeground'),
    border: color('border'),
    radius: Math.round(radius),
    fontFamily: t.fontFamily,
    density: t.density,
    mode: t.mode,
  };
}

// ─── entidade padrão ⇄ `defaults` ────────────────────────────────────────────────────────────────

const DEFAULT_KEY: Record<WidgetEntityType, 'competitionId' | 'teamId' | 'eventId'> = {
  competition: 'competitionId',
  team: 'teamId',
  event: 'eventId',
};

/** Entidade padrão gravada em `defaults` (a primeira que houver: jogo, time, competição). */
export function entityFromDefaults(
  defaults: WidgetDefaults | null | undefined,
): { type: WidgetEntityType; id: string } | null {
  if (defaults?.eventId) return { type: 'event', id: defaults.eventId };
  if (defaults?.teamId) return { type: 'team', id: defaults.teamId };
  if (defaults?.competitionId) return { type: 'competition', id: defaults.competitionId };
  return null;
}

export function defaultsFromEntity(entity: { type: WidgetEntityType; id: string } | null): WidgetDefaults {
  return entity ? { [DEFAULT_KEY[entity.type]]: entity.id } : {};
}

// ─── validação do que chega do navegador ─────────────────────────────────────────────────────────

/** Ids da API: UUID; competições também aceitam slug. */
const ENTITY_ID = /^[0-9a-z][0-9a-z-]{0,119}$/i;

export type WidgetInputError = 'kind' | 'name' | 'theme' | 'locale' | 'market' | 'entity';

export interface WidgetInput {
  kind: WidgetKind;
  name: string;
  config: WidgetConfig;
}

/**
 * Valida o que o navegador mandou para salvar. `markets` = mercados do plano (vazio = qualquer país);
 * `entityTypes` = entidades que o tipo de widget aceita (do catálogo).
 */
export function parseWidgetInput(
  raw: unknown,
  opts: { markets: string[]; entityTypes: (kind: WidgetKind) => readonly WidgetEntityType[] },
): { ok: true; value: WidgetInput } | { ok: false; error: WidgetInputError } {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!isWidgetKind(r.kind)) return { ok: false, error: 'kind' };
  const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > NAME_MAX) return { ok: false, error: 'name' };
  const c = (r.config ?? {}) as Record<string, unknown>;
  const theme = parseTheme(c.theme);
  if (!theme) return { ok: false, error: 'theme' };
  if (!isWidgetLocale(c.locale)) return { ok: false, error: 'locale' };
  if (typeof c.market !== 'string' || !/^[A-Za-z]{2}$/.test(c.market)) return { ok: false, error: 'market' };
  const market = c.market.toUpperCase();
  if (opts.markets.length && !opts.markets.includes(market)) return { ok: false, error: 'market' };

  const d = (c.defaults ?? {}) as Record<string, unknown>;
  const given = (Object.keys(DEFAULT_KEY) as WidgetEntityType[]).filter((type) => d[DEFAULT_KEY[type]]);
  if (given.length > 1) return { ok: false, error: 'entity' };
  const type = given[0];
  let defaults: WidgetDefaults = {};
  if (type) {
    const id = d[DEFAULT_KEY[type]];
    if (!opts.entityTypes(r.kind).includes(type) || typeof id !== 'string' || !ENTITY_ID.test(id))
      return { ok: false, error: 'entity' };
    defaults = defaultsFromEntity({ type, id });
  }
  return {
    ok: true,
    value: { kind: r.kind, name, config: { theme, locale: c.locale, market, defaults } },
  };
}

/**
 * Domínios de uma chave publicável, um por linha (ou separados por vírgula/espaço). Sem esquema vira
 * https (`app.exemplo.com` → `https://app.exemplo.com`). `normalize` é o `normalizeAllowedOrigin` de
 * `@galaxie/db` (a mesma regra que a API usa para conferir o `Origin`).
 */
export function parseOrigins(
  text: string,
  normalize: (pattern: string) => string | null,
): { origins: string[]; invalid: string[] } {
  const origins = new Set<string>();
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const value = normalize(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (value) origins.add(value);
    else invalid.push(raw);
  }
  return { origins: [...origins], invalid };
}

// ─── instalação ──────────────────────────────────────────────────────────────────────────────────

/** Endereço público do registry dos widgets (o domínio da demo). */
export const REGISTRY_BASE_URL = (process.env.NEXT_PUBLIC_GALAXIE_REGISTRY_URL || SITE_URL).replace(
  /\/+$/,
  '',
);

export const registryUrl = (id: string, base = REGISTRY_BASE_URL) => `${base}/r/${id}.json`;

export const installCommand = (id: string, base = REGISTRY_BASE_URL) =>
  `npx shadcn@latest add ${registryUrl(id, base)}`;

/** `<uuid>.json` (o segmento da rota) → id do widget, ou null. */
export function parseRegistryParam(param: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i.exec(param);
  return m ? m[1]!.toLowerCase() : null;
}

/** Componente que o arquivo instalado exporta (o `registryComponent` do catálogo de `@galaxie/widgets`). */
export const REGISTRY_COMPONENTS: Record<WidgetKind, string> = {
  match_card: 'GalaxieMatchCard',
  live_list: 'GalaxieLiveList',
  standings: 'GalaxieStandingsTable',
  where_to_watch: 'GalaxieWhereToWatch',
};

/**
 * Como usar o componente instalado. O registry grava o tema, o idioma, o mercado e a entidade padrão no
 * próprio arquivo (`components/galaxie/<nome>.tsx`), então a tag vai sem props.
 */
export function usageSnippet(widget: { kind: WidgetKind; name: string }): string {
  const file = toRegistryName(widget.name) || `galaxie-${widget.kind.replace(/_/g, '-')}`;
  const component = REGISTRY_COMPONENTS[widget.kind];
  return [`import { ${component} } from '@/components/galaxie/${file}';`, ``, `<${component} />`].join('\n');
}
