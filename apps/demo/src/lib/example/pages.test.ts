import { describe, expect, it } from 'vitest';

import { EXAMPLE_PAGES, exampleHref, exampleIds } from './pages';

const BR = exampleIds('pt-BR');
const AR = exampleIds('es-AR');

describe('links dentro do exemplo', () => {
  it('a página do app de cada entidade do exemplo vira a página do exemplo', () => {
    expect(exampleHref('pt-BR', `/events/${BR.match}`)).toBe('/example/match');
    expect(exampleHref('pt-BR', `/teams/${BR.team}`)).toBe('/example/team');
    expect(exampleHref('en', `/competitions/${BR.competition}`)).toBe('/example/competition');
    expect(exampleHref('es-AR', `/people/${AR.player}`)).toBe('/example/player');
  });

  it('mantém as abas da query string', () => {
    expect(exampleHref('pt-BR', `/events/${BR.match}?details=lineups&lineup=pitch`)).toBe(
      '/example/match?details=lineups&lineup=pitch',
    );
    expect(exampleHref('pt-BR', '/example/team?tab=elenco')).toBe('/example/team?tab=elenco');
  });

  it('o que não está na cópia fica de fora (demo completa)', () => {
    // outra entidade, a entidade da outra versão, outra temporada, outra data e outro site
    expect(exampleHref('pt-BR', '/teams/00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(exampleHref('pt-BR', `/teams/${AR.team}`)).toBeNull();
    expect(exampleHref('pt-BR', `/teams/${BR.team}?season=2025`)).toBeNull();
    expect(exampleHref('pt-BR', `/competitions/${BR.competition}?date=2025-05-01`)).toBeNull();
    expect(exampleHref('pt-BR', 'https://exemplo.com/eventos/1')).toBeNull();
    expect(exampleHref('pt-BR', '/sports/football')).toBeNull();
  });

  it('cada versão tem as quatro páginas', () => {
    for (const ids of [BR, AR]) expect(Object.keys(ids).sort()).toEqual([...EXAMPLE_PAGES].sort());
  });
});
