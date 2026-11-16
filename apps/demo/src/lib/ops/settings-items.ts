/**
 * Itens do menu de Ajustes (épico #1066): Início fixo no topo e 9 grupos com 46 itens, 29 que já existem e 17
 * planejados com o selo "Em breve" (decisão A5). Puro (sem React nem servidor): o proxy, os redirecionamentos, o mapa
 * ajuste → página e os testes leem daqui; os ícones e os textos ficam em `components/admin/settings-nav.tsx` e no
 * dicionário (`ops.nav`).
 */

/** Grupos do menu (#1068). A ordem na tela é a alfabética do idioma (`sortByLabel`), não esta. */
export const SETTINGS_NAV_GROUPS = [
  'canais',
  'clientes',
  'comercial',
  'conformidade',
  'dados',
  'engajamento',
  'inteligencia',
  'plataforma',
  'produtos',
] as const;
export type SettingsNavGroupId = (typeof SETTINGS_NAV_GROUPS)[number];

const REPO = 'https://github.com/galaxie-works/galaxie-sports/issues';
/** Épico da navegação de Ajustes: destino do "Em breve" que ainda não tem issue própria. */
export const SETTINGS_EPIC_URL = `${REPO}/1066`;
const issue = (n: number) => `${REPO}/${n}`;

/** Item planejado: a página de espera leva à issue da feature (ou ao épico, quando ela ainda não existe). */
export interface SoonInfo {
  href: string;
}

export interface SettingsItemDef {
  id: string;
  href: string;
  group: SettingsNavGroupId;
  soon?: SoonInfo;
}

/** Início: fora dos grupos e da ordem alfabética (A2). */
export const SETTINGS_HOME = { id: 'home', href: '/settings' } as const;

export const SETTINGS_ITEMS = [
  // Canais
  { id: 'tvApps', href: '/settings/tv-apps', group: 'canais', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'site', href: '/settings/site', group: 'canais', soon: { href: SETTINGS_EPIC_URL } },
  {
    id: 'messaging',
    href: '/settings/whatsapp-telegram',
    group: 'canais',
    soon: { href: SETTINGS_EPIC_URL },
  },
  // Clientes
  // Carteiras da Cosmos (#1060): a primeira parte de Assinaturas e carteiras; a rota fica a do #1060
  { id: 'subscriptions', href: '/settings/wallets', group: 'clientes' },
  // Cadastros e trials (#1136, F2): o liga/desliga do cadastro em autoatendimento, a versão dos termos e o prazo do trial
  { id: 'signups', href: '/settings/signups', group: 'clientes' },
  { id: 'domains', href: '/settings/domains', group: 'clientes', soon: { href: SETTINGS_EPIC_URL } },
  // Organizações e marcas (#1136, F2): a organização de cada marca, faixa de capacidade, revisão e as ações da equipe
  { id: 'organizations', href: '/settings/organizations', group: 'clientes' },
  { id: 'users', href: '/settings/users', group: 'clientes' },
  { id: 'webhooks', href: '/settings/webhooks', group: 'clientes' },
  // Comercial
  { id: 'catalog', href: '/settings/catalog', group: 'comercial', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'metering', href: '/settings/metering', group: 'comercial', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'plans', href: '/settings/plans', group: 'comercial', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'advertising', href: '/settings/advertising', group: 'comercial', soon: { href: SETTINGS_EPIC_URL } },
  // Conformidade
  // Ficha por país (#954): regras de idade, entidade, moeda e prêmio por país, com versão e histórico
  { id: 'countryProfile', href: '/settings/country-profile', group: 'conformidade' },
  {
    id: 'legalHold',
    href: '/settings/legal-hold',
    group: 'conformidade',
    soon: { href: SETTINGS_EPIC_URL },
  },
  { id: 'moderation', href: '/settings/moderation', group: 'conformidade' },
  {
    id: 'secondAppeal',
    href: '/settings/second-appeal',
    group: 'conformidade',
    soon: { href: SETTINGS_EPIC_URL },
  },
  { id: 'terms', href: '/settings/terms', group: 'conformidade', soon: { href: issue(1022) } },
  // Dados
  { id: 'crests', href: '/settings/crests', group: 'dados' },
  { id: 'mirror', href: '/settings/mirror', group: 'dados' },
  // Módulos por esporte e tier (docs/03 §11.6): o liga/desliga de cada dado por esporte e tier, com o custo de cota
  { id: 'modules', href: '/settings/modules', group: 'dados' },
  { id: 'provider', href: '/settings/provider', group: 'dados' },
  { id: 'quality', href: '/settings/quality', group: 'dados' },
  { id: 'review', href: '/settings/review', group: 'dados' },
  // Engajamento
  // Identidade do torcedor (#937): a validade do token gft_; o segredo fica em Credenciais
  { id: 'fanIdentity', href: '/settings/fan-identity', group: 'engajamento' },
  { id: 'liveChat', href: '/settings/live-chat', group: 'engajamento', soon: { href: issue(915) } },
  { id: 'communities', href: '/settings/communities', group: 'engajamento', soon: { href: issue(936) } },
  { id: 'gamification', href: '/settings/gamification', group: 'engajamento', soon: { href: issue(904) } },
  // Shopping (#914): lojas da Galaxie e a curadoria dos produtos oficiais por entidade
  { id: 'shopping', href: '/settings/shopping', group: 'engajamento' },
  // Inteligência
  { id: 'cosmos', href: '/settings/cosmos', group: 'inteligencia' },
  { id: 'ai', href: '/settings/ai', group: 'inteligencia' },
  // Plataforma
  { id: 'schedule', href: '/settings/schedule', group: 'plataforma' },
  { id: 'credentials', href: '/settings/credentials', group: 'plataforma' },
  { id: 'emails', href: '/settings/emails', group: 'plataforma', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'history', href: '/settings/history', group: 'plataforma' },
  { id: 'languages', href: '/settings/languages', group: 'plataforma', soon: { href: issue(1024) } },
  { id: 'status', href: '/settings/status', group: 'plataforma' },
  { id: 'suggestions', href: '/settings/suggestions', group: 'plataforma' },
  { id: 'tasks', href: '/settings/tasks', group: 'plataforma' },
  // Produtos
  { id: 'live', href: '/settings/live', group: 'produtos' },
  { id: 'lineup', href: '/settings/lineups', group: 'produtos' },
  { id: 'wtw', href: '/settings/where-to-watch', group: 'produtos' },
  { id: 'postgame', href: '/settings/post-game', group: 'produtos' },
  { id: 'narration', href: '/settings/play-by-play', group: 'produtos' },
  { id: 'related', href: '/settings/videos', group: 'produtos' },
  { id: 'widgets', href: '/settings/widgets', group: 'produtos', soon: { href: SETTINGS_EPIC_URL } },
] as const satisfies readonly SettingsItemDef[];

export type SettingsItem = (typeof SETTINGS_ITEMS)[number];
export type SettingsItemId = SettingsItem['id'];
/** Item ativo no menu: um dos 45 ou o Início. */
export type SettingsNavId = SettingsItemId | typeof SETTINGS_HOME.id;

type SoonItem = Extract<SettingsItem, { soon: SoonInfo }>;
export type SoonItemId = SoonItem['id'];

export const SOON_ITEMS: readonly SoonItem[] = SETTINGS_ITEMS.filter((i): i is SoonItem => 'soon' in i);

/** Último segmento da rota do item planejado (`/settings/tv-apps` → `tv-apps`). */
export const soonSlug = (item: { href: string }) => item.href.slice('/settings/'.length);

export function soonItemBySlug(slug: string): SoonItem | undefined {
  return SOON_ITEMS.find((i) => soonSlug(i) === slug);
}

export function settingsItem(id: SettingsItemId): SettingsItem {
  return SETTINGS_ITEMS.find((i) => i.id === id)!;
}

export const settingsHref = (id: SettingsNavId): string =>
  id === SETTINGS_HOME.id ? SETTINGS_HOME.href : settingsItem(id).href;

/**
 * Item de Ajustes de um caminho (`/settings/live`, `/settings/review/123`, também com o prefixo de idioma que o
 * proxy acrescenta ao reescrever). Fora de Ajustes: null.
 */
export function settingsNavIdOf(pathname: string | null): SettingsNavId | null {
  if (!pathname) return null;
  const path = pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/settings(\/|$))/, '').replace(/\/+$/, '');
  if (path === SETTINGS_HOME.href) return SETTINGS_HOME.id;
  const item = SETTINGS_ITEMS.find((i) => path === i.href || path.startsWith(`${i.href}/`));
  return item?.id ?? null;
}
