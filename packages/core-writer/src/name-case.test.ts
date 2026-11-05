import { describe, expect, it } from 'vitest';
import { tidyParticles } from './name-case.js';

describe('tidyParticles', () => {
  it('partícula em caixa alta no meio do nome vira minúscula', () => {
    expect(tidyParticles('Vasco DA Gama')).toBe('Vasco da Gama');
    expect(tidyParticles('Brasil DE Pelotas')).toBe('Brasil de Pelotas');
    expect(tidyParticles('Univ. DE Costa Rica')).toBe('Univ. de Costa Rica');
  });

  it('não mexe na primeira palavra, em nome todo em maiúsculas nem em nome já certo', () => {
    expect(tidyParticles('DOS Kampen')).toBe('DOS Kampen');
    expect(tidyParticles('VASCO DA GAMA')).toBe('VASCO DA GAMA');
    expect(tidyParticles('Vasco da Gama')).toBe('Vasco da Gama');
    expect(tidyParticles(null)).toBeNull();
  });
});
