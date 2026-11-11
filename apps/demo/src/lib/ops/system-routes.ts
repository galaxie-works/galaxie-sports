/**
 * Tabela única dos links antigos de Ajustes (#1069). As páginas Operação, Sistema e Esportes e features se dividiram
 * em itens do menu (#1066); toda rota e toda aba antiga (`?aba=` e `?tab=`) leva ao item novo, com a âncora da seção
 * quando houver. O proxy responde com redirecionamento permanente (308). Puro: o proxy e os testes leem daqui.
 */
import type { LegacyTab } from './panel-tabs';
import { settingsHref } from './settings-items';

/** Para onde foi cada aba de antes (do Sistema e de Esportes e features). */
const TAB_ROUTE: Record<LegacyTab, string> = {
  status: settingsHref('status'),
  quality: settingsHref('quality'),
  live: settingsHref('live'),
  schedule: settingsHref('schedule'),
  tasks: settingsHref('tasks'),
  ai: settingsHref('ai'),
  provider: settingsHref('provider'),
  mirror: settingsHref('mirror'),
  assets: `${settingsHref('crests')}#assets`,
  suggestions: settingsHref('suggestions'),
  cosmos: settingsHref('cosmos'),
  history: settingsHref('history'),
  sports: `${settingsHref('provider')}#sports`,
  related: settingsHref('related'),
  wtw: settingsHref('wtw'),
};

/** Rotas que sumiram e para onde vão sem aba: a primeira seção que cada uma mostrava. */
export const LEGACY_PAGES: Readonly<Record<string, string>> = {
  '/ajustes/operacao': TAB_ROUTE.status,
  '/ajustes/sistema': TAB_ROUTE.assets,
  '/ajustes/esportes': TAB_ROUTE.sports,
};

/** Parâmetros da aba nos links antigos (o #1001 usava `?aba=`; links de antes dele, `?tab=`). */
const TAB_PARAMS = ['aba', 'tab'] as const;

/** Rota nova da aba antiga; null quando a aba não existe. */
export function systemTabRoute(tab: string | undefined | null): string | null {
  if (!tab) return null;
  return Object.hasOwn(TAB_ROUTE, tab) ? TAB_ROUTE[tab as LegacyTab] : null;
}

/**
 * Destino de um link antigo de Ajustes (caminho, query que sobra e âncora), ou null quando o caminho não é um deles.
 * Aceita o prefixo de idioma (`/pt-BR/ajustes/operacao`), que o proxy acrescenta ao reescrever. Os outros parâmetros
 * seguem (a busca dos canais: `/ajustes/esportes?aba=related&q=x` → `/ajustes/videos?q=x`).
 */
export function legacySettingsRedirect(pathname: string, search: URLSearchParams): string | null {
  const path = pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/ajustes\/)/, '').replace(/\/+$/, '');
  const fallback = LEGACY_PAGES[path];
  if (!fallback) return null;
  const tab = TAB_PARAMS.map((p) => search.get(p)).find(Boolean);
  const target = systemTabRoute(tab) ?? fallback;
  const rest = new URLSearchParams(search);
  for (const p of TAB_PARAMS) rest.delete(p);
  const [base, hash] = target.split('#') as [string, string | undefined];
  const query = rest.toString();
  return `${base}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}
