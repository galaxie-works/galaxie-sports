import { describe, expect, it } from 'vitest';

import { LOCALES } from './i18n/config';
import { LEGACY_FAMILY_SLUGS } from './legacy-routes';
import { getDictionary } from './i18n/dictionary';
import { FAMILIES, SPORTS, sportParent } from './navigation';
import {
  SPORT_FAMILIES,
  familyOf,
  legacySportRedirect,
  mergeFamilyCompetitions,
  sortFamilyCompetitions,
  sportHref,
} from './sport-families';

describe('famílias de esporte', () => {
  it('cada esporte da API está em exatamente uma família', () => {
    for (const s of SPORTS) {
      expect(SPORT_FAMILIES.filter((f) => (f.sports as readonly string[]).includes(s.slug))).toHaveLength(1);
    }
    expect(SPORT_FAMILIES.flatMap((f) => f.sports)).toHaveLength(SPORTS.length);
  });

  it('NBA dentro de Basquete e F1 em Automobilismo; o menu tem uma entrada por família', () => {
    expect(familyOf('nba')?.id).toBe('basquete');
    expect(familyOf('basketball')?.id).toBe('basquete');
    expect(familyOf('formula-1')?.id).toBe('automobilismo');
    expect(familyOf('mma')?.id).toBe('lutas');
    expect(FAMILIES.map((f) => f.href)).not.toContain('/sports/nba');
    expect(FAMILIES).toHaveLength(SPORT_FAMILIES.length);
  });

  it('rótulo de cada família nos três idiomas', () => {
    for (const locale of LOCALES) {
      const labels = getDictionary(locale).nav.families as Record<string, string>;
      for (const f of SPORT_FAMILIES) expect(labels[f.id], `${locale}: ${f.id}`).toBeTruthy();
    }
    expect(getDictionary('es-AR').nav.families.automobilismo).toBe('Automovilismo');
  });

  it('slug da família igual ao de um esporte da API só quando o esporte é dela (senão o redirecionamento prenderia)', () => {
    const sports = new Set<string>(SPORTS.map((s) => s.slug));
    for (const f of SPORT_FAMILIES) {
      if (sports.has(f.slug)) expect(familyOf(f.slug)?.id, f.slug).toBe(f.id);
    }
  });

  it('slug da URL em inglês, sem acento, e a tabela das rotas antigas leva cada id ao slug (#630)', () => {
    for (const f of SPORT_FAMILIES) {
      expect(f.slug, f.id).toMatch(/^[a-z0-9-]+$/);
      expect(LEGACY_FAMILY_SLUGS[f.id], f.id).toBe(f.slug);
    }
  });

  it('link de um esporte: a família, com a âncora da seção própria', () => {
    expect(sportHref('nba')).toBe('/sports/basketball#nba');
    expect(sportHref('basketball')).toBe('/sports/basketball');
    expect(sportHref('formula-1')).toBe('/sports/motorsport');
    expect(sportHref('curling')).toBeNull();
  });

  it('esporte pai de competição, time e jogo é a família, com o rótulo do menu', () => {
    expect(sportParent('nba', getDictionary('pt-BR'))).toEqual({
      path: '/sports/basketball',
      label: 'Basquete',
      kind: 'esporte',
    });
  });
});

describe('rotas antigas', () => {
  it('/sports/<esporte da API> vai para a família', () => {
    expect(legacySportRedirect('/sports/nba')).toBe('/sports/basketball#nba');
    expect(legacySportRedirect('/sports/formula-1')).toBe('/sports/motorsport');
    expect(legacySportRedirect('/sports/football/')).toBeNull();
    expect(legacySportRedirect('/sports/afl')).toBe('/sports/australian-football');
  });

  it('o caminho em português de antes do #630 chega à família num salto só', () => {
    expect(legacySportRedirect('/esportes/nba')).toBe('/sports/basketball#nba');
    expect(legacySportRedirect('/esportes/formula-1/')).toBe('/sports/motorsport');
    expect(legacySportRedirect('/esportes/basquete')).toBeNull();
  });

  it('com o prefixo de idioma: tira para casar e devolve no destino', () => {
    expect(legacySportRedirect('/pt-BR/esportes/nba')).toBe('/pt-BR/sports/basketball#nba');
    expect(legacySportRedirect('/en/esportes/formula-1')).toBe('/en/sports/motorsport');
    expect(legacySportRedirect('/es-AR/sports/nba')).toBe('/es-AR/sports/basketball#nba');
    expect(legacySportRedirect('/pt-BR/sports/basketball')).toBeNull();
    expect(legacySportRedirect('/fr/sports/nba')).toBeNull();
  });

  it('rotas novas, desconhecidas e de fora ficam como estão', () => {
    expect(legacySportRedirect('/sports/basketball')).toBeNull();
    expect(legacySportRedirect('/sports/curling')).toBeNull();
    expect(legacySportRedirect('/competitions/nba')).toBeNull();
    expect(legacySportRedirect('/sports/nba/extra')).toBeNull();
  });
});

describe('competições da família', () => {
  const basquete = SPORT_FAMILIES.find((f) => f.id === 'basquete')!;
  const c = (slug: string, name: string, logo: string | null = null) => ({ slug, name, logo });

  it('a mesma competição nas duas APIs aparece uma vez, na versão da NBA', () => {
    const merged = mergeFamilyCompetitions(basquete, [
      {
        sport: 'basketball',
        items: [
          c('nba-basketball', 'NBA', 'https://cdn/leagues/12.png'),
          c('usa-nba-las-vegas-summer-league', 'NBA - Las Vegas Summer League'),
          c('nbb', 'NBB'),
        ],
      },
      {
        sport: 'nba',
        items: [
          c('nba', 'NBA', 'https://cdn/leagues/12.png'),
          c('nba-summer-league-las-vegas', 'NBA Summer League Las Vegas'),
        ],
      },
    ]);
    expect(merged).toEqual([
      { sport: 'basketball', items: [c('nbb', 'NBB')] },
      {
        sport: 'nba',
        items: [
          c('nba', 'NBA', 'https://cdn/leagues/12.png'),
          c('nba-summer-league-las-vegas', 'NBA Summer League Las Vegas'),
        ],
      },
    ]);
  });

  it('mesmo logo com nome diferente também é a mesma competição', () => {
    const merged = mergeFamilyCompetitions(basquete, [
      { sport: 'basketball', items: [c('a', 'National Basketball Association', 'https://cdn/12.png')] },
      { sport: 'nba', items: [c('nba', 'NBA', 'https://cdn/12.png')] },
    ]);
    expect(merged[0]!.items).toEqual([]);
  });

  it('ligas homônimas (ou com o mesmo logo) dentro do mesmo esporte ficam todas', () => {
    const items = [
      c('premier-league-39', 'Premier League', 'https://cdn/generic.png'),
      c('premier-league-nz', 'Premier League', 'https://cdn/generic.png'),
      c('national-league', 'National League', 'https://cdn/generic.png'),
    ];
    const merged = mergeFamilyCompetitions(basquete, [
      { sport: 'basketball', items },
      { sport: 'nba', items: [c('nba', 'NBA')] },
    ]);
    expect(merged[0]!.items).toEqual(items);
    expect(merged[1]!.items).toEqual([c('nba', 'NBA')]);
  });
});

describe('ordem das competições no grupo', () => {
  const comp = (slug: string, level: 'national' | 'regional' | null, order: number | null) => ({
    slug,
    name: slug,
    level,
    order,
    tier: 1,
  });

  it('nacionais antes dos estaduais, mesmo com o estadual entre os destaques', () => {
    const items = [
      comp('paulista', 'regional', 0),
      comp('serie-b', 'national', 2),
      comp('copa-do-brasil', 'national', 1),
      comp('serie-a', 'national', 0),
      comp('carioca', 'regional', 1),
    ];
    const featured = new Map([
      ['serie-a', 0],
      ['paulista', 1],
    ]);
    expect(sortFamilyCompetitions(items, featured, 'pt-BR').map((c) => c.slug)).toEqual([
      'serie-a',
      'copa-do-brasil',
      'serie-b',
      'paulista',
      'carioca',
    ]);
  });
});
