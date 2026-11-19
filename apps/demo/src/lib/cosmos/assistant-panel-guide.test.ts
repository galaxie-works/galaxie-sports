import { panelGuideChunks } from '@galaxie/cosmos';
import { describe, expect, it } from 'vitest';

import { CLIENT_NAV } from '@/components/client/client-nav-shared';

describe('guia do painel para a Cosmos (#1411)', () => {
  it('cobre todas as áreas do menu do cliente', () => {
    const hrefs = new Set(panelGuideChunks(false).map((c) => c.href));
    for (const area of CLIENT_NAV) expect(hrefs, area.href).toContain(area.href);
  });

  it('as telas de Ajustes só entram para a equipe Galaxie', () => {
    expect(panelGuideChunks(false).some((c) => c.href.startsWith('/settings'))).toBe(false);
    const staff = panelGuideChunks(true);
    expect(staff.some((c) => c.href === '/settings/wallets' && /Pacotes/.test(c.text))).toBe(true);
  });

  it('trechos com rota do painel e tamanho que cabe na busca', () => {
    for (const c of panelGuideChunks(true)) {
      expect(c.href).toMatch(/^\/(client|settings)(\/|$)/);
      expect(c.text.length).toBeGreaterThan(80);
      expect(c.text.length).toBeLessThanOrEqual(1500);
    }
  });
});
