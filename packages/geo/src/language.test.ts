import { describe, expect, it } from 'vitest';
import { competitionName, countryLanguage, isNationalCompetition } from './language.js';

describe('countryLanguage', () => {
  it('mapeia país → idioma dos rótulos, inclusive as extensões da api-sports', () => {
    expect(countryLanguage('BR')).toBe('pt');
    expect(countryLanguage('PT')).toBe('pt');
    expect(countryLanguage('AR')).toBe('es');
    expect(countryLanguage('es')).toBe('es');
    expect(countryLanguage('GB-ENG')).toBe('en');
    expect(countryLanguage('US')).toBe('en');
    expect(countryLanguage('JP')).toBeNull();
    expect(countryLanguage('WORLD')).toBeNull();
    expect(countryLanguage(null)).toBeNull();
  });

  it('distingue competição nacional de internacional pelo código', () => {
    expect(isNationalCompetition('BR')).toBe(true);
    expect(isNationalCompetition('GB-ENG')).toBe(true);
    expect(isNationalCompetition('XK')).toBe(true);
    expect(isNationalCompetition('WORLD')).toBe(false);
    expect(isNationalCompetition('SOUTH-AMERICA')).toBe(false);
    expect(isNationalCompetition('EUROPE')).toBe(false);
    expect(isNationalCompetition(null)).toBe(false);
  });
});

describe('competitionName', () => {
  const copaDoBrasil = { 'pt-BR': 'Copa do Brasil', es: 'Copa de Brasil', en: 'Copa do Brasil' };
  const ligaProfesional = {
    'pt-BR': 'Campeonato Argentino (Liga Profesional)',
    es: 'Liga Profesional de Fútbol',
    en: 'Argentine Liga Profesional',
  };
  const premier = {
    'pt-BR': 'Premier League (Campeonato Inglês)',
    es: 'Premier League',
    en: 'Premier League',
  };
  const sula = { 'pt-BR': 'Copa Sul-Americana', es: 'Copa Sudamericana', en: 'Copa Sudamericana' };

  it('nacional: o nome no idioma do país em qualquer locale', () => {
    for (const locale of ['pt-BR', 'es-AR', 'es-MX', 'en'])
      expect(competitionName(copaDoBrasil, 'BR', 'Copa Do Brasil', locale)).toBe('Copa do Brasil');
    for (const locale of ['pt-BR', 'es-AR', 'en'])
      expect(competitionName(ligaProfesional, 'AR', 'Liga Profesional Argentina', locale)).toBe(
        'Liga Profesional de Fútbol',
      );
    for (const locale of ['pt-BR', 'es-CL', 'en'])
      expect(competitionName(premier, 'GB-ENG', 'Premier League', locale)).toBe('Premier League');
  });

  it('nacional: a variante do país vence o idioma neutro; outra variante serve antes do en', () => {
    expect(
      competitionName(
        { 'es-AR': 'Liga Profesional', es: 'Liga Profesional de Fútbol' },
        'AR',
        'LPF',
        'pt-BR',
      ),
    ).toBe('Liga Profesional');
    expect(competitionName({ 'es-MX': 'Liga MX', en: 'Liga MX (Mexico)' }, 'MX', 'Liga MX', 'pt-BR')).toBe(
      'Liga MX',
    );
    expect(
      competitionName(
        { pt: 'Primeira Liga', en: 'Primeira Liga (Portugal)' },
        'PT',
        'Primeira Liga',
        'es-AR',
      ),
    ).toBe('Primeira Liga');
  });

  it('nacional sem rótulo no idioma do país: en e depois o nome oficial do fornecedor', () => {
    expect(competitionName({ es: 'Liga X' }, 'BR', 'Serie A', 'es-AR')).toBe('Serie A');
    expect(competitionName({ es: 'Liga X', en: 'League X' }, 'BR', 'Serie A', 'es-AR')).toBe('League X');
    expect(competitionName(null, 'BR', 'Serie A', 'pt-BR')).toBe('Serie A');
  });

  it('país sem idioma mapeado: rótulo en, senão o nome oficial', () => {
    const j1 = { 'pt-BR': 'J-League', es: 'J-League', en: 'J1 League' };
    expect(competitionName(j1, 'JP', 'J1 League', 'pt-BR')).toBe('J1 League');
    expect(competitionName({ 'pt-BR': 'Liga Saudita' }, 'SA', 'Pro League', 'pt-BR')).toBe('Pro League');
  });

  it('continental e mundial: o rótulo da entidade em cada idioma (cadeia es-XX → es → en)', () => {
    expect(competitionName(sula, 'WORLD', 'CONMEBOL Sudamericana', 'pt-BR')).toBe('Copa Sul-Americana');
    expect(competitionName(sula, 'WORLD', 'CONMEBOL Sudamericana', 'es-AR')).toBe('Copa Sudamericana');
    expect(competitionName(sula, 'WORLD', 'CONMEBOL Sudamericana', 'en')).toBe('Copa Sudamericana');
    expect(competitionName({ 'pt-BR': 'Libertadores' }, 'WORLD', 'CONMEBOL Libertadores', 'es-AR')).toBe(
      'CONMEBOL Libertadores',
    );
    expect(competitionName({ en: 'Euroleague' }, 'EUROPE', 'Euroleague', 'es-AR')).toBe('Euroleague');
    expect(competitionName(sula, null, 'CONMEBOL Sudamericana', 'es-UY')).toBe('Copa Sudamericana');
  });
});
