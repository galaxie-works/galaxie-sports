/** Abas do painel de Operação e as áreas do Sistema no menu de Ajustes (puro: sem servidor nem React). */

/** Sistema: saúde e infraestrutura. Esportes e features: o plano de cada esporte e as regras das features. */
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
    'engage',
    'history',
  ],
  features: ['sports', 'related', 'wtw'],
} as const;
export type PanelScope = keyof typeof PANEL_TABS;

/**
 * As áreas do Sistema viram itens do menu lateral de Ajustes (#1001), cada uma com as seções empilhadas, sem abas
 * dentro de abas. Toda aba do Sistema está em exatamente uma área (o teste confere).
 */
export const SYSTEM_VIEWS = {
  operation: ['status', 'quality', 'live', 'schedule', 'tasks'],
  provider: ['provider', 'mirror'],
  ai: ['ai'],
  system: ['assets', 'suggestions', 'cosmos', 'engage', 'history'],
} as const satisfies Record<string, readonly (typeof PANEL_TABS)['system'][number][]>;
export type SystemView = keyof typeof SYSTEM_VIEWS;
