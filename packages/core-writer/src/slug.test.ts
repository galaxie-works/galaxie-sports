import { describe, expect, it } from 'vitest';
import { competitionSlugBase } from './competition-slug.js';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('remove acentos e pontuação', () => {
    expect(slugify('Paulista - A1 (São Paulo)')).toBe('paulista-a1-sao-paulo');
  });

  it('não deixa hífen nas pontas', () => {
    expect(slugify('  Atlético de Madrid!  ')).toBe('atletico-de-madrid');
  });
});

describe('competitionSlugBase', () => {
  it('junta país e nome, sem número do fornecedor', () => {
    expect(competitionSlugBase('Japan', 'NPB Minor League')).toBe('japan-npb-minor-league');
  });

  it('não repete o trecho comum entre país e nome', () => {
    expect(competitionSlugBase('World', 'World Cup')).toBe('world-cup');
    expect(competitionSlugBase('Asia', 'Asia Professional Championship')).toBe('asia-professional-championship');
    expect(competitionSlugBase('Australia-Oceania', 'Oceania Sevens Championships')).toBe(
      'australia-oceania-sevens-championships',
    );
  });

  it('mantém número que é parte do nome', () => {
    expect(competitionSlugBase('Chile', 'LNB 2')).toBe('chile-lnb-2');
  });

  it('apóstrofo não vira hífen', () => {
    expect(competitionSlugBase('World', "Seven's World Series")).toBe('world-sevens-world-series');
  });

  it('não cola país parecido com o começo do nome', () => {
    expect(competitionSlugBase('Europe', 'European Championship')).toBe('europe-european-championship');
  });
});
