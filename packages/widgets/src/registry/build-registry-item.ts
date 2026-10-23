import { WIDGET_CATALOG } from '../catalog.js';
import {
  WIDGET_KINDS,
  WIDGET_LOCALES,
  type WidgetDefaults,
  type WidgetKind,
  type WidgetLocale,
  type WidgetTheme,
} from '../core/model.js';
import { CORE_FILE, CORE_VERSION, WIDGET_FILES } from './sources.generated.js';

export const REGISTRY_ITEM_SCHEMA_URL = 'https://ui.shadcn.com/schema/registry-item.json';
export const PUBLISHABLE_KEY_ENV = 'NEXT_PUBLIC_GALAXIE_PUBLISHABLE_KEY';

/** Pasta (no app da operadora) onde os arquivos são instalados. */
const TARGET_DIR = 'components/galaxie';
const CORE_NAME = 'galaxie-core';

export interface BuildRegistryItemInput {
  kind: WidgetKind;
  /** Nome do widget no Builder (vira o `name` do item e o nome do arquivo, em kebab-case). */
  name: string;
  theme: WidgetTheme;
  /** Base da API pública, ex.: https://api.galaxie.sports */
  apiBaseUrl: string;
  locale?: WidgetLocale | undefined;
  /** País ISO2. */
  market?: string | undefined;
  /** Props padrão do widget (o evento, a competição…), salvas no Builder. */
  defaults?: WidgetDefaults | undefined;
  /** Título legível (padrão: `name`). */
  title?: string | undefined;
  description?: string | undefined;
}

export interface RegistryItemFile {
  path: string;
  type: 'registry:component';
  target: string;
  content: string;
}

/** Item no formato https://ui.shadcn.com/schema/registry-item.json */
export interface RegistryItem {
  $schema: typeof REGISTRY_ITEM_SCHEMA_URL;
  name: string;
  type: 'registry:block';
  title: string;
  description: string;
  author: string;
  dependencies: string[];
  files: RegistryItemFile[];
  cssVars: { light: Record<string, string>; dark: Record<string, string> };
  envVars: Record<string, string>;
  docs: string;
  categories: string[];
  meta: { galaxie: { kind: WidgetKind; locale: WidgetLocale; market: string | null; core: string } };
}

/** "Operadora Exemplo · Placar!" → "operadora-exemplo-placar" */
export function toRegistryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

const COLOR_KEYS = ['primary', 'background', 'surface', 'foreground', 'mutedForeground', 'border'] as const;

function assertTheme(theme: WidgetTheme): void {
  for (const key of COLOR_KEYS) {
    const value = theme[key];
    // cor CSS simples: hex, rgb()/hsl()/oklch() ou nome — nada que feche a string ou a declaração
    if (typeof value !== 'string' || !/^[#a-zA-Z0-9(),.%\s/-]{1,64}$/.test(value)) {
      throw new TypeError(`tema inválido: ${key}`);
    }
  }
  if (typeof theme.radius !== 'number' || !Number.isFinite(theme.radius))
    throw new TypeError('tema inválido: radius');
  if (
    typeof theme.fontFamily !== 'string' ||
    theme.fontFamily.length > 200 ||
    /[;{}<>]/.test(theme.fontFamily)
  ) {
    throw new TypeError('tema inválido: fontFamily');
  }
  if (theme.density !== 'compact' && theme.density !== 'comfortable')
    throw new TypeError('tema inválido: density');
  if (theme.mode !== 'light' && theme.mode !== 'dark') throw new TypeError('tema inválido: mode');
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Props padrão aceitas por cada widget, a partir de `defaults` do Builder. */
function defaultProps(kind: WidgetKind, defaults: WidgetDefaults, market: string | undefined) {
  const pick = (keys: (keyof WidgetDefaults)[]) =>
    Object.fromEntries(keys.filter((k) => defaults[k]).map((k) => [k, defaults[k]]));
  switch (kind) {
    case 'match_card':
      return pick(['eventId']);
    case 'live_list':
      return pick(['competitionId', 'sport']);
    case 'standings':
      return pick(['competitionId']);
    case 'where_to_watch':
      return { ...pick(['eventId']), ...(market ? { market } : {}) };
  }
}

const DOCS: Record<WidgetLocale, (component: string, file: string) => string> = {
  'pt-BR': (component, file) =>
    `Widget Galaxie Sports instalado em ${file}.\n` +
    `1. Defina ${PUBLISHABLE_KEY_ENV} no .env.local com a chave publicável do portal (ou passe publishableKey).\n` +
    `2. Use: import { ${component} } from '@/${file.replace(/\.tsx$/, '')}'; <${component} />\n` +
    'O tema salvo no Builder está no início do arquivo (GALAXIE_THEME); ajuste por lá ou pela prop theme.',
  es: (component, file) =>
    `Widget de Galaxie Sports instalado en ${file}.\n` +
    `1. Define ${PUBLISHABLE_KEY_ENV} en .env.local con la clave publicable del portal (o pasa publishableKey).\n` +
    `2. Uso: import { ${component} } from '@/${file.replace(/\.tsx$/, '')}'; <${component} />\n` +
    'El tema guardado en el Builder está al inicio del archivo (GALAXIE_THEME); ajústalo allí o con la prop theme.',
  en: (component, file) =>
    `Galaxie Sports widget installed at ${file}.\n` +
    `1. Set ${PUBLISHABLE_KEY_ENV} in .env.local to the publishable key from the portal (or pass publishableKey).\n` +
    `2. Usage: import { ${component} } from '@/${file.replace(/\.tsx$/, '')}'; <${component} />\n` +
    'The theme saved in the Builder sits at the top of the file (GALAXIE_THEME); tweak it there or via the theme prop.',
};

/**
 * Monta o item de registry shadcn de um widget configurado no Builder. Dois arquivos:
 * - `components/galaxie/galaxie-core.tsx`: núcleo comum (tema, API, textos), igual para todos os widgets;
 * - `components/galaxie/<name>.tsx`: o widget escolhido com o tema salvo embutido, exportando
 *   `Galaxie<Componente>` pronto para receber `publishableKey` por prop ou pela env.
 */
export function buildRegistryItem(input: BuildRegistryItemInput): RegistryItem {
  const { kind, theme, apiBaseUrl } = input;
  if (!(WIDGET_KINDS as readonly string[]).includes(kind))
    throw new TypeError(`tipo de widget desconhecido: ${kind}`);
  assertTheme(theme);
  let api: URL;
  try {
    api = new URL(apiBaseUrl);
  } catch {
    throw new TypeError('apiBaseUrl inválida');
  }
  if (api.protocol !== 'https:' && api.protocol !== 'http:')
    throw new TypeError('apiBaseUrl precisa ser http(s)');
  const locale = input.locale ?? 'pt-BR';
  if (!(WIDGET_LOCALES as readonly string[]).includes(locale))
    throw new TypeError(`locale inválido: ${locale}`);
  const market = input.market?.trim().toUpperCase() || undefined;
  if (market && !/^[A-Z]{2}$/.test(market)) throw new TypeError('market precisa ser ISO 3166-1 alfa-2');

  const catalog = WIDGET_CATALOG[kind];
  const widget = WIDGET_FILES[kind];
  const name = toRegistryName(input.name) || `galaxie-${kind.replace(/_/g, '-')}`;
  if (name === CORE_NAME) throw new TypeError(`o nome "${CORE_NAME}" é reservado`);
  const title = input.title?.trim() || input.name.trim() || catalog.name[locale];
  const fileTarget = `${TARGET_DIR}/${name}.tsx`;
  const component = catalog.registryComponent;
  const props = widget.propsType;
  const defaults = defaultProps(kind, input.defaults ?? {}, market);
  const cleanTheme: WidgetTheme = {
    primary: theme.primary,
    background: theme.background,
    surface: theme.surface,
    foreground: theme.foreground,
    mutedForeground: theme.mutedForeground,
    border: theme.border,
    radius: theme.radius,
    fontFamily: theme.fontFamily,
    density: theme.density,
    mode: theme.mode,
  };

  const coreImports = [
    ...new Set([...widget.coreImports, 'GalaxieWidgetProvider', 'type WidgetLocale', 'type WidgetTheme']),
  ];
  const marketProp = kind === 'where_to_watch' ? `, market: market ?? GALAXIE_MARKET ?? 'BR'` : '';
  const content = [
    "'use client';",
    '',
    `// ${title} · widget Galaxie Sports (${kind}), gerado pelo Galaxie Sports Builder.`,
    `// Chave publicável: prop \`publishableKey\` ou a variável ${PUBLISHABLE_KEY_ENV}.`,
    '',
    ...(widget.reactImports.length ? [`import { ${widget.reactImports.join(', ')} } from 'react';`] : []),
    `import { ${coreImports.join(', ')} } from './${CORE_NAME}';`,
    '',
    '/** Tema salvo no Builder. Ajuste as cores aqui ou passe `theme` (parcial) por prop. */',
    `export const GALAXIE_THEME: WidgetTheme = ${JSON.stringify(cleanTheme, null, 2)};`,
    '',
    `const GALAXIE_API_URL = ${JSON.stringify(api.href.replace(/\/+$/, ''))};`,
    `const GALAXIE_LOCALE: WidgetLocale = ${JSON.stringify(locale)};`,
    `const GALAXIE_MARKET: string | undefined = ${market ? JSON.stringify(market) : 'undefined'};`,
    `const GALAXIE_DEFAULTS: Partial<${props}> = ${JSON.stringify(defaults)};`,
    '',
    '// `process` declarado aqui para compilar também sem @types/node; o Next troca a env no build.',
    'declare const process: { env: Record<string, string | undefined> } | undefined;',
    `const ENV_PUBLISHABLE_KEY: string | undefined =`,
    `  typeof process !== 'undefined' ? process.env.${PUBLISHABLE_KEY_ENV} : undefined;`,
    '',
    widget.body,
    '',
    `export type ${component}Props = Partial<${props}> & {`,
    '  publishableKey?: string;',
    '  baseUrl?: string;',
    '  locale?: WidgetLocale;',
    '  market?: string;',
    '  theme?: Partial<WidgetTheme>;',
    '  className?: string;',
    '};',
    '',
    `export function ${component}({`,
    '  publishableKey,',
    '  baseUrl,',
    '  locale,',
    '  market,',
    '  theme,',
    '  className,',
    '  ...props',
    `}: ${component}Props) {`,
    `  const widgetProps = { ...GALAXIE_DEFAULTS, ...props${marketProp} } as ${props};`,
    '  return (',
    '    <GalaxieWidgetProvider',
    '      baseUrl={baseUrl ?? GALAXIE_API_URL}',
    "      publishableKey={publishableKey ?? ENV_PUBLISHABLE_KEY ?? ''}",
    '      theme={{ ...GALAXIE_THEME, ...theme }}',
    '      locale={locale ?? GALAXIE_LOCALE}',
    '      market={market ?? GALAXIE_MARKET}',
    '      className={className}',
    '    >',
    `      <${widget.component} {...widgetProps} />`,
    '    </GalaxieWidgetProvider>',
    '  );',
    '}',
    '',
    `export default ${component};`,
    '',
  ].join('\n');

  const colors = Object.fromEntries(COLOR_KEYS.map((key) => [`gs-${kebab(key)}`, cleanTheme[key]]));
  return {
    $schema: REGISTRY_ITEM_SCHEMA_URL,
    name,
    type: 'registry:block',
    title,
    description: input.description?.trim() || catalog.description[locale],
    author: 'Galaxie Sports',
    dependencies: [],
    files: [
      {
        path: `registry/galaxie/${CORE_NAME}.tsx`,
        type: 'registry:component',
        target: `${TARGET_DIR}/${CORE_NAME}.tsx`,
        content: CORE_FILE,
      },
      { path: `registry/galaxie/${name}.tsx`, type: 'registry:component', target: fileTarget, content },
    ],
    // As cores do tema também viram tokens do app (`bg-gs-primary` no Tailwind), para o resto da página
    // acompanhar o widget. O widget em si usa o GALAXIE_THEME embutido, independente do CSS global.
    cssVars: { light: colors, dark: colors },
    envVars: { [PUBLISHABLE_KEY_ENV]: '' },
    docs: DOCS[locale](component, fileTarget),
    categories: ['galaxie', 'sports', kind.replace(/_/g, '-')],
    meta: { galaxie: { kind, locale, market: market ?? null, core: CORE_VERSION } },
  };
}
