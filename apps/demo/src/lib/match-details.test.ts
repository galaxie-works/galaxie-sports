import { describe, expect, it } from 'vitest';

import { activeTab, DETAIL_TABS, LINEUP_TABS, panelSemantics } from './match-details';

describe('abas dos detalhes da partida', () => {
  const all = new Set(DETAIL_TABS);

  it('usa a aba pedida na URL quando ela tem dado', () => {
    expect(activeTab('escalacao', DETAIL_TABS, all)).toBe('escalacao');
    expect(activeTab('campo', LINEUP_TABS, new Set(LINEUP_TABS))).toBe('campo');
  });

  it('sem pedido, pedido inválido ou aba sem dado: a primeira disponível na ordem', () => {
    expect(activeTab(undefined, DETAIL_TABS, all)).toBe('minuto');
    expect(activeTab(['minuto'], DETAIL_TABS, all)).toBe('minuto');
    expect(activeTab('xyz', DETAIL_TABS, all)).toBe('minuto');
    // antes do apito: sem lances, abre nas estatísticas ou na escalação
    expect(activeTab('minuto', DETAIL_TABS, new Set(['escalacao', 'estatisticas'] as const))).toBe(
      'estatisticas',
    );
    expect(activeTab('campo', LINEUP_TABS, new Set(['titulares', 'reservas'] as const))).toBe('titulares');
  });

  it('nada disponível: null', () => {
    expect(activeTab('minuto', DETAIL_TABS, new Set())).toBeNull();
  });
});

describe('semântica do painel', () => {
  it('uma aba só (sem barra de abas): região com o nome da aba', () => {
    expect(panelSemantics(new Set(['minuto']), 'Minuto a minuto')).toEqual({
      role: 'region',
      'aria-label': 'Minuto a minuto',
    });
  });

  it('mais de uma aba: o painel fica nomeado pela própria aba', () => {
    expect(panelSemantics(new Set(['minuto', 'estatisticas']), 'Minuto a minuto')).toEqual({});
  });
});
