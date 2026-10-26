import { describe, expect, it } from 'vitest';
import { orderTableGroups, tableGroupTitle } from './standings-groups';

const labels = { annual: 'Tabela anual', firstPhase: '1ª fase', unnamed: 'Grupo sem nome {n}' };

describe('tableGroupTitle', () => {
  it('traduz os grupos reservados e deixa os do fornecedor para a página', () => {
    expect(tableGroupTitle('annual', labels)).toBe('Tabela anual');
    expect(tableGroupTitle('first_phase', labels)).toBe('1ª fase');
    expect(tableGroupTitle('unnamed:3', labels)).toBe('Grupo sem nome 3');
    expect(tableGroupTitle('Apertura - Group A', labels)).toBeNull();
    expect(tableGroupTitle(null, labels)).toBeNull();
  });
});

describe('orderTableGroups', () => {
  it('1ª fase primeiro, deduzidos depois dos do fornecedor e a anual no fim', () => {
    const names = ['annual', 'Clausura', 'unnamed:10', 'first_phase', 'unnamed:2', 'Apertura'];
    expect(orderTableGroups(names.map((name) => ({ name }))).map((g) => g.name)).toEqual([
      'first_phase',
      'Clausura',
      'Apertura',
      'unnamed:2',
      'unnamed:10',
      'annual',
    ]);
  });
});
