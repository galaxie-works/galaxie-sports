import { describe, expect, it } from 'vitest';

import { getDictionary } from './i18n/dictionary';
import { countryHref, eventCompetitionHref, sportParent } from './navigation';

describe('links de navegação', () => {
  it('país só ganha link com código de país (ISO2 ou extensão como GB-ENG)', () => {
    expect(countryHref('BR')).toBe('/paises/br');
    expect(countryHref('GB-ENG')).toBe('/paises/gb-eng');
    expect(countryHref('World')).toBeNull();
    expect(countryHref(null)).toBeNull();
  });

  it('competição a partir do jogo abre nos jogos, na rodada e na temporada do jogo', () => {
    const href = eventCompetitionHref({
      competition: { slug: 'brasileirao-serie-a' },
      stage: { name: 'Rodada 32' },
      starts_at: '2026-10-23T20:00:00-03:00',
    });
    expect(href).toBe('/competicoes/brasileirao-serie-a?aba=jogos&data=2026-10-23&rodada=Rodada+32');
    expect(eventCompetitionHref({ competition: null, stage: null, starts_at: '2026-10-23' })).toBeNull();
  });

  it('esporte pai usa o rótulo do menu', () => {
    expect(sportParent('formula-1', getDictionary('pt-BR'))).toEqual({
      path: '/esportes/formula-1',
      label: 'Fórmula 1',
      kind: 'esporte',
    });
    expect(sportParent('curling', getDictionary('pt-BR'))).toBeNull();
  });
});
