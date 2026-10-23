import { describe, expect, it } from 'vitest';

import { winPct } from './standings';

describe('winPct', () => {
  it('formata como a NFL: três casas, sem o zero à esquerda; empate vale meia vitória', () => {
    expect(winPct(13, 0, 17)).toBe('.765');
    expect(winPct(8, 1, 17)).toBe('.500');
    expect(winPct(17, 0, 17)).toBe('1.000');
    expect(winPct(0, 0, 17)).toBe('.000');
    expect(winPct(0, 0, 0)).toBe('—');
  });
});
