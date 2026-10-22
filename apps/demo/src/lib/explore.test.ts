import { describe, expect, it } from 'vitest';

import { compactNumber, countryLayout, SPORT_HUES, sportUnits } from './explore';
import { SPORTS } from './navigation';

describe('countryLayout', () => {
  const conmebol = ['BR', 'AR', 'UY', 'CL'] as const;

  it('põe os países em destaque primeiro e largos, mantendo a ordem do menu no resto', () => {
    expect(countryLayout(conmebol, 'BR')).toEqual([
      { code: 'BR', wide: true },
      { code: 'AR', wide: true },
      { code: 'UY', wide: false },
      { code: 'CL', wide: false },
    ]);
  });

  it('o mercado do idioma vai à frente (Argentina em es-AR)', () => {
    expect(countryLayout(conmebol, 'AR').map((c) => c.code)).toEqual(['AR', 'BR', 'UY', 'CL']);
  });

  it('grupo com até dois países: todos largos', () => {
    expect(countryLayout(['MX'], 'BR')).toEqual([{ code: 'MX', wide: true }]);
    expect(countryLayout(['ES', 'IT', 'DE'], 'BR').every((c) => !c.wide)).toBe(true);
  });
});

describe('sportUnits', () => {
  it('conta lutadores no MMA, participantes e eventos na F1 e times e jogos no resto', () => {
    expect(sportUnits('mma')).toEqual({ participants: 'fighters', events: 'events' });
    expect(sportUnits('formula-1')).toEqual({ participants: 'participants', events: 'events' });
    expect(sportUnits('football')).toEqual({ participants: 'teams', events: 'games' });
  });
});

describe('SPORT_HUES', () => {
  it('tem um matiz para cada esporte do menu, perto do índigo da marca', () => {
    for (const s of SPORTS) {
      expect(SPORT_HUES[s.slug]).toBeGreaterThanOrEqual(230);
      expect(SPORT_HUES[s.slug]).toBeLessThanOrEqual(320);
    }
  });
});

describe('compactNumber', () => {
  it('abrevia a partir de 10 mil', () => {
    expect(compactNumber('pt-BR', 9094)).toBe('9.094');
    expect(compactNumber('en', 12_400)).toBe('12K');
  });
});
