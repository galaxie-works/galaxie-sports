/** Blocos do painel de Operação e o que cada item do menu de Ajustes mostra (puro: sem servidor nem React). */

/**
 * Abas de antes do #1066 (lista fechada do #1001): o Sistema e Esportes e features. Não aparecem mais na tela; ficam
 * como a lista do que os links antigos `?aba=` podem trazer (`lib/ops/system-routes.ts` e o teste de redirecionamento).
 */
export const PANEL_TABS = {
  system: [
    'status',
    'quality',
    'live',
    'schedule',
    'tasks',
    'ai',
    'provider',
    'mirror',
    'assets',
    'suggestions',
    'cosmos',
    'history',
  ],
  features: ['sports', 'related', 'wtw'],
} as const;
export type PanelScope = keyof typeof PANEL_TABS;
export type LegacyTab = (typeof PANEL_TABS)[PanelScope][number];

/**
 * Blocos do painel (cartões com as linhas de ajuste e os painéis de status). Ao vivo e Pós-jogo são uma seção só no
 * registro (`live`) e viram dois blocos pela lista de chaves (`settingPage`); as credenciais juntam todas as chaves
 * (A4) e `lineup` são os `LINEUP_*` em Grades e ofertas.
 */
export const PANEL_BLOCKS = [
  'status',
  'quality',
  'live',
  'postgame',
  'schedule',
  'tasks',
  'ai',
  'provider',
  'sports',
  'credentials',
  'mirror',
  'wtw',
  'related',
  'lineup',
  'assets',
  'suggestions',
  'cosmos',
  'engage',
  'history',
] as const;
export type PanelBlock = (typeof PANEL_BLOCKS)[number];

/**
 * O que cada página de Ajustes mostra do painel, na ordem (#1069). Página com um bloco só mostra o bloco sem título de
 * seção (o título é o da página). Todo bloco está em exatamente uma página (o teste confere).
 */
export const SETTINGS_VIEWS = {
  status: ['status'],
  quality: ['quality'],
  live: ['live'],
  postgame: ['postgame'],
  schedule: ['schedule'],
  tasks: ['tasks'],
  ai: ['ai'],
  provider: ['provider', 'sports'],
  credentials: ['credentials'],
  mirror: ['mirror'],
  wtw: ['wtw'],
  related: ['related'],
  lineup: ['lineup'],
  crests: ['assets'],
  suggestions: ['suggestions'],
  cosmos: ['cosmos'],
  fanIdentity: ['engage'],
  history: ['history'],
} as const satisfies Record<string, readonly PanelBlock[]>;
export type SettingsView = keyof typeof SETTINGS_VIEWS;
