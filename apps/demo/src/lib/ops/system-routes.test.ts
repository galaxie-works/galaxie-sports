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
    expect(go('/ajustes/operacao')).toBe('/ajustes/status');
    expect(go('/ajustes/sistema')).toBe('/ajustes/escudos#assets');
    expect(go('/ajustes/esportes')).toBe('/ajustes/fornecedor#sports');
    for (const [from, to] of Object.entries(LEGACY_PAGES)) {
      expect(routes.has(pathOf(to)), `${from} → ${to}`).toBe(true);
    }
  });

  it.each([
    ['/ajustes/sistema', 'aba=status', '/ajustes/status'],
    ['/ajustes/sistema', 'aba=quality', '/ajustes/qualidade'],
    ['/ajustes/sistema', 'aba=live', '/ajustes/ao-vivo'],
    ['/ajustes/sistema', 'aba=schedule', '/ajustes/agenda'],
    ['/ajustes/sistema', 'aba=tasks', '/ajustes/tarefas'],
    ['/ajustes/sistema', 'aba=ai', '/ajustes/ia'],
    ['/ajustes/sistema', 'aba=provider', '/ajustes/fornecedor'],
    ['/ajustes/sistema', 'aba=mirror', '/ajustes/espelho'],
    ['/ajustes/sistema', 'aba=assets', '/ajustes/escudos#assets'],
    ['/ajustes/sistema', 'aba=suggestions', '/ajustes/sugestoes'],
    ['/ajustes/sistema', 'aba=cosmos', '/ajustes/cosmos'],
    ['/ajustes/sistema', 'aba=history', '/ajustes/historico'],
    ['/ajustes/sistema', 'tab=history', '/ajustes/historico'],
    ['/ajustes/operacao', 'aba=schedule', '/ajustes/agenda'],
    ['/ajustes/esportes', 'aba=sports', '/ajustes/fornecedor#sports'],
    ['/ajustes/esportes', 'aba=related', '/ajustes/videos'],
    ['/ajustes/esportes', 'aba=wtw', '/ajustes/onde-assistir'],
    ['/ajustes/esportes', 'aba=nao-existe', '/ajustes/fornecedor#sports'],
  ])('%s?%s → %s', (path, query, target) => {
    expect(go(path, query)).toBe(target);
  });

  it('os outros parâmetros seguem (busca e filtro dos canais) e o prefixo de idioma sai', () => {
    expect(go('/ajustes/esportes', 'aba=related&q=espn&filtro=blocked')).toBe(
      '/ajustes/videos?q=espn&filtro=blocked',
    );
    expect(go('/pt-BR/ajustes/operacao', 'aba=tasks')).toBe('/ajustes/tarefas');
    expect(go('/ajustes/sistema/')).toBe('/ajustes/escudos#assets');
  });

  it('as rotas novas e as que continuam não redirecionam', () => {
    for (const href of routes) expect(go(href), href).toBeNull();
    expect(go('/ajustes')).toBeNull();
    expect(go('/ajustes/fornecedor', 'aba=mirror')).toBeNull();
    expect(go('/ajustes/revisao/123')).toBeNull();
    expect(go('/operacao')).toBeNull();
  });
});
