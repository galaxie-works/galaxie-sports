/**
 * Itens do menu de Ajustes (épico #1066): Início fixo no topo e 9 grupos com 45 itens, 25 que já existem e 20
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
export const SETTINGS_HOME = { id: 'home', href: '/ajustes' } as const;

export const SETTINGS_ITEMS = [
  // Canais
  { id: 'tvApps', href: '/ajustes/apps-de-tv', group: 'canais', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'site', href: '/ajustes/site', group: 'canais', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'messaging', href: '/ajustes/whatsapp-telegram', group: 'canais', soon: { href: SETTINGS_EPIC_URL } },
  // Clientes
  // Carteiras da Cosmos (#1060): a primeira parte de Assinaturas e carteiras; a rota fica a do #1060
  { id: 'subscriptions', href: '/ajustes/carteiras', group: 'clientes' },
  { id: 'signups', href: '/ajustes/cadastros', group: 'clientes', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'domains', href: '/ajustes/dominios', group: 'clientes', soon: { href: SETTINGS_EPIC_URL } },
  {
    id: 'organizations',
    href: '/ajustes/organizacoes',
    group: 'clientes',
    soon: { href: SETTINGS_EPIC_URL },
  },
  { id: 'users', href: '/ajustes/usuarios', group: 'clientes' },
  { id: 'webhooks', href: '/ajustes/webhooks', group: 'clientes' },
  // Comercial
  { id: 'catalog', href: '/ajustes/catalogo', group: 'comercial', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'metering', href: '/ajustes/medicao', group: 'comercial', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'plans', href: '/ajustes/planos', group: 'comercial', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'advertising', href: '/ajustes/publicidade', group: 'comercial', soon: { href: SETTINGS_EPIC_URL } },
  // Conformidade
  // Ficha por país (#954): regras de idade, entidade, moeda e prêmio por país, com versão e histórico
  { id: 'countryProfile', href: '/ajustes/ficha-por-pais', group: 'conformidade' },
  {
    id: 'legalHold',
    href: '/ajustes/guarda-legal',
    group: 'conformidade',
    soon: { href: SETTINGS_EPIC_URL },
  },
  { id: 'moderation', href: '/ajustes/moderacao', group: 'conformidade' },
  {
    id: 'secondAppeal',
    href: '/ajustes/segunda-apelacao',
    group: 'conformidade',
    soon: { href: SETTINGS_EPIC_URL },
  },
  { id: 'terms', href: '/ajustes/termos', group: 'conformidade', soon: { href: issue(1022) } },
  // Dados
  { id: 'crests', href: '/ajustes/escudos', group: 'dados' },
  { id: 'mirror', href: '/ajustes/espelho', group: 'dados' },
  // Módulos por esporte e tier (docs/03 §11.6): o liga/desliga de cada dado por esporte e tier, com o custo de cota
  { id: 'modules', href: '/ajustes/modulos', group: 'dados' },
  { id: 'provider', href: '/ajustes/fornecedor', group: 'dados' },
  { id: 'quality', href: '/ajustes/qualidade', group: 'dados' },
  { id: 'review', href: '/ajustes/revisao', group: 'dados' },
  // Engajamento
  // Identidade do torcedor (#937): a validade do token gft_; o segredo fica em Credenciais
  { id: 'fanIdentity', href: '/ajustes/torcedor', group: 'engajamento' },
  { id: 'liveChat', href: '/ajustes/chat-ao-vivo', group: 'engajamento', soon: { href: issue(915) } },
  { id: 'communities', href: '/ajustes/comunidades', group: 'engajamento', soon: { href: issue(936) } },
  { id: 'gamification', href: '/ajustes/gamificacao', group: 'engajamento', soon: { href: issue(904) } },
  { id: 'shopping', href: '/ajustes/shopping', group: 'engajamento', soon: { href: issue(909) } },
  // Inteligência
  { id: 'cosmos', href: '/ajustes/cosmos', group: 'inteligencia' },
  { id: 'ai', href: '/ajustes/ia', group: 'inteligencia' },
  // Plataforma
  { id: 'schedule', href: '/ajustes/agenda', group: 'plataforma' },
  { id: 'credentials', href: '/ajustes/credenciais', group: 'plataforma' },
  { id: 'emails', href: '/ajustes/emails', group: 'plataforma', soon: { href: SETTINGS_EPIC_URL } },
  { id: 'history', href: '/ajustes/historico', group: 'plataforma' },
  { id: 'languages', href: '/ajustes/idiomas', group: 'plataforma', soon: { href: issue(1024) } },
  { id: 'status', href: '/ajustes/status', group: 'plataforma' },
  { id: 'suggestions', href: '/ajustes/sugestoes', group: 'plataforma' },
  { id: 'tasks', href: '/ajustes/tarefas', group: 'plataforma' },
  // Produtos
  { id: 'live', href: '/ajustes/ao-vivo', group: 'produtos' },
  { id: 'lineup', href: '/ajustes/grades', group: 'produtos' },
  { id: 'wtw', href: '/ajustes/onde-assistir', group: 'produtos' },
  { id: 'postgame', href: '/ajustes/pos-jogo', group: 'produtos' },
  { id: 'related', href: '/ajustes/videos', group: 'produtos' },
  { id: 'widgets', href: '/ajustes/widgets', group: 'produtos', soon: { href: SETTINGS_EPIC_URL } },
] as const satisfies readonly SettingsItemDef[];

export type SettingsItem = (typeof SETTINGS_ITEMS)[number];
export type SettingsItemId = SettingsItem['id'];
/** Item ativo no menu: um dos 45 ou o Início. */
export type SettingsNavId = SettingsItemId | typeof SETTINGS_HOME.id;

type SoonItem = Extract<SettingsItem, { soon: SoonInfo }>;
export type SoonItemId = SoonItem['id'];

export const SOON_ITEMS: readonly SoonItem[] = SETTINGS_ITEMS.filter((i): i is SoonItem => 'soon' in i);

/** Último segmento da rota do item planejado (`/ajustes/apps-de-tv` → `apps-de-tv`). */
export const soonSlug = (item: { href: string }) => item.href.slice('/ajustes/'.length);

export function soonItemBySlug(slug: string): SoonItem | undefined {
  return SOON_ITEMS.find((i) => soonSlug(i) === slug);
}

export function settingsItem(id: SettingsItemId): SettingsItem {
  return SETTINGS_ITEMS.find((i) => i.id === id)!;
}

export const settingsHref = (id: SettingsNavId): string =>
  id === SETTINGS_HOME.id ? SETTINGS_HOME.href : settingsItem(id).href;

/**
 * Item de Ajustes de um caminho (`/ajustes/ao-vivo`, `/ajustes/revisao/123`, também com o prefixo de idioma que o
 * proxy acrescenta ao reescrever). Fora de Ajustes: null.
 */
export function settingsNavIdOf(pathname: string | null): SettingsNavId | null {
  if (!pathname) return null;
  const path = pathname.replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/ajustes(\/|$))/, '').replace(/\/+$/, '');
  if (path === SETTINGS_HOME.href) return SETTINGS_HOME.id;
  const item = SETTINGS_ITEMS.find((i) => path === i.href || path.startsWith(`${i.href}/`));
  return item?.id ?? null;
}
