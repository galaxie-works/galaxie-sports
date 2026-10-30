import { describe, expect, it } from 'vitest';
import { compareAlpha, sortByLabel } from './alphabetical';

describe('ordem alfabética', () => {
  it('ignora acento e caixa, como num índice em português', () => {
    const names = ['Rússia', 'Estados Unidos', 'israel', 'Áustria', 'França', 'Polônia', 'Bulgária', 'Egito'];
    expect([...names].sort(compareAlpha)).toEqual([
      'Áustria',
      'Bulgária',
      'Egito',
      'Estados Unidos',
      'França',
      'israel',
      'Polônia',
      'Rússia',
    ]);
  });

  it('números em ordem natural', () => {
    expect(sortByLabel([{ label: 'Liga 10' }, { label: 'Liga 2' }]).map((o) => o.label)).toEqual([
      'Liga 2',
      'Liga 10',
    ]);
  });

  it('não mexe na lista original', () => {
    const list = [{ label: 'B' }, { label: 'A' }];
    sortByLabel(list);
    expect(list[0].label).toBe('B');
  });
});
