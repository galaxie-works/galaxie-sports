import { describe, expect, it } from 'vitest';

import { PANEL_BLOCKS, PANEL_TABS, SETTINGS_VIEWS } from './panel-tabs';
import { SETTINGS_ITEMS } from './settings-items';
import { LEGACY_PAGES, legacySettingsRedirect, systemTabRoute } from './system-routes';

const go = (path: string, query = '') => legacySettingsRedirect(path, new URLSearchParams(query));
const routes = new Set<string>(SETTINGS_ITEMS.map((i) => i.href));
const pathOf = (target: string) => target.split(/[?#]/)[0]!;

describe('páginas de Ajustes divididas (#1069)', () => {
  it('todo bloco do painel está em exatamente uma página, e toda página é um item do menu', () => {
    const placed = Object.values(SETTINGS_VIEWS).flat();
    expect([...placed].sort()).toEqual([...PANEL_BLOCKS].sort());
    expect(new Set(placed).size).toBe(placed.length);
    const ids = new Set<string>(SETTINGS_ITEMS.map((i) => i.id));
    for (const view of Object.keys(SETTINGS_VIEWS)) expect(ids.has(view), view).toBe(true);
  });

  it('toda aba antiga (lista fechada do #1001) tem destino num item que existe', () => {
    for (const tab of [...PANEL_TABS.system, ...PANEL_TABS.features]) {
      const target = systemTabRoute(tab);
      expect(target, tab).not.toBeNull();
      expect(routes.has(pathOf(target!)), `${tab} → ${target}`).toBe(true);
    }
    expect(systemTabRoute('nao-existe')).toBeNull();
    expect(systemTabRoute(undefined)).toBeNull();
    expect(systemTabRoute('constructor')).toBeNull();
  });

  it('as rotas que sumiram vão para a primeira seção que mostravam', () => {
    expect(go('/ajustes/operacao')).toBe('/settings/status');
    expect(go('/ajustes/sistema')).toBe('/settings/crests#assets');
    expect(go('/ajustes/esportes')).toBe('/settings/provider#sports');
    for (const [from, to] of Object.entries(LEGACY_PAGES)) {
      expect(routes.has(pathOf(to)), `${from} → ${to}`).toBe(true);
    }
  });

  it.each([
    ['/ajustes/sistema', 'aba=status', '/settings/status'],
    ['/ajustes/sistema', 'aba=quality', '/settings/quality'],
    ['/ajustes/sistema', 'aba=live', '/settings/live'],
    ['/ajustes/sistema', 'aba=schedule', '/settings/schedule'],
    ['/ajustes/sistema', 'aba=tasks', '/settings/tasks'],
    ['/ajustes/sistema', 'aba=ai', '/settings/ai'],
    ['/ajustes/sistema', 'aba=provider', '/settings/provider'],
    ['/ajustes/sistema', 'aba=mirror', '/settings/mirror'],
    ['/ajustes/sistema', 'aba=assets', '/settings/crests#assets'],
    ['/ajustes/sistema', 'aba=suggestions', '/settings/suggestions'],
    ['/ajustes/sistema', 'aba=cosmos', '/settings/cosmos'],
    ['/ajustes/sistema', 'aba=history', '/settings/history'],
    ['/ajustes/sistema', 'tab=history', '/settings/history'],
    ['/ajustes/operacao', 'aba=schedule', '/settings/schedule'],
    ['/ajustes/esportes', 'aba=sports', '/settings/provider#sports'],
    ['/ajustes/esportes', 'aba=related', '/settings/videos'],
    ['/ajustes/esportes', 'aba=wtw', '/settings/where-to-watch'],
    ['/ajustes/esportes', 'aba=nao-existe', '/settings/provider#sports'],
  ])('%s?%s → %s', (path, query, target) => {
    expect(go(path, query)).toBe(target);
  });

  it('os outros parâmetros seguem (busca e filtro dos canais) e o prefixo de idioma sai', () => {
    expect(go('/ajustes/esportes', 'aba=related&q=espn&filtro=blocked')).toBe(
      '/settings/videos?q=espn&filtro=blocked',
    );
    expect(go('/pt-BR/ajustes/operacao', 'aba=tasks')).toBe('/settings/tasks');
    expect(go('/ajustes/sistema/')).toBe('/settings/crests#assets');
  });

  it('as rotas novas e as que continuam não redirecionam', () => {
    for (const href of routes) expect(go(href), href).toBeNull();
    expect(go('/settings')).toBeNull();
    expect(go('/settings/provider', 'aba=mirror')).toBeNull();
    expect(go('/settings/review/123')).toBeNull();
    expect(go('/operacao')).toBeNull();
  });
});
