import { describe, expect, it } from 'vitest';

import { activeTab, DETAIL_TABS, LINEUP_TABS, panelSemantics } from './match-details';

describe('abas dos detalhes da partida', () => {
  const all = new Set(DETAIL_TABS);

  it('usa a aba pedida na URL quando ela tem dado', () => {
    expect(activeTab('lineups', DETAIL_TABS, all)).toBe('lineups');
    expect(activeTab('pitch', LINEUP_TABS, new Set(LINEUP_TABS))).toBe('pitch');
  });

  it('sem pedido, pedido inválido ou aba sem dado: a primeira disponível na ordem', () => {
    expect(activeTab(undefined, DETAIL_TABS, all)).toBe('timeline');
    expect(activeTab(['timeline'], DETAIL_TABS, all)).toBe('timeline');
    expect(activeTab('xyz', DETAIL_TABS, all)).toBe('timeline');
    // antes do apito: sem lances, abre nas estatísticas ou na escalação
    expect(activeTab('timeline', DETAIL_TABS, new Set(['lineups', 'statistics'] as const))).toBe(
      'statistics',
    );
    expect(activeTab('pitch', LINEUP_TABS, new Set(['starters', 'substitutes'] as const))).toBe('starters');
  });

  it('nada disponível: null', () => {
    expect(activeTab('timeline', DETAIL_TABS, new Set())).toBeNull();
  });
});

describe('semântica do painel', () => {
  it('uma aba só (sem barra de abas): região com o nome da aba', () => {
    expect(panelSemantics(new Set(['timeline']), 'Minuto a minuto')).toEqual({
      role: 'region',
      'aria-label': 'Minuto a minuto',
    });
  });

  it('mais de uma aba: o painel fica nomeado pela própria aba', () => {
    expect(panelSemantics(new Set(['timeline', 'statistics']), 'Minuto a minuto')).toEqual({});
  });
});
