import { describe, expect, it } from 'vitest';

import { PANEL_TABS, SYSTEM_VIEWS } from './panel-tabs';

import { systemTabRoute } from './system-routes';

describe('Sistema dividido em áreas (#1001)', () => {
  it('toda aba do Sistema está em exatamente uma área', () => {
    const placed = Object.values(SYSTEM_VIEWS).flat();
    expect([...placed].sort()).toEqual([...PANEL_TABS.system].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('o link antigo de cada aba vai para a área dela', () => {
    expect(systemTabRoute('status')).toBe('/ajustes/operacao');
    expect(systemTabRoute('tasks')).toBe('/ajustes/operacao');
    expect(systemTabRoute('mirror')).toBe('/ajustes/fornecedor');
    expect(systemTabRoute('ai')).toBe('/ajustes/ia');
    expect(systemTabRoute('history')).toBe('/ajustes/sistema');
    expect(systemTabRoute('nao-existe')).toBeNull();
    expect(systemTabRoute(undefined)).toBeNull();
    for (const tab of PANEL_TABS.system) expect(systemTabRoute(tab), tab).not.toBeNull();
  });
});
