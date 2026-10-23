import { describe, expect, it } from 'vitest';

import { EXAMPLE_PAGES, exampleHref, exampleIds } from './pages';

const BR = exampleIds('pt-BR');
const AR = exampleIds('es-AR');

describe('links dentro do exemplo', () => {
  it('a página do app de cada entidade do exemplo vira a página do exemplo', () => {
    expect(exampleHref('pt-BR', `/eventos/${BR.jogo}`)).toBe('/exemplo/jogo');
    expect(exampleHref('pt-BR', `/times/${BR.time}`)).toBe('/exemplo/time');
    expect(exampleHref('en', `/competicoes/${BR.campeonato}`)).toBe('/exemplo/campeonato');
    expect(exampleHref('es-AR', `/pessoas/${AR.jogador}`)).toBe('/exemplo/jogador');
  });

  it('mantém as abas da query string', () => {
    expect(exampleHref('pt-BR', `/eventos/${BR.jogo}?detalhes=escalacao&escalacao=campo`)).toBe(
      '/exemplo/jogo?detalhes=escalacao&escalacao=campo',
    );
    expect(exampleHref('pt-BR', '/exemplo/time?aba=elenco')).toBe('/exemplo/time?aba=elenco');
  });

  it('o que não está na cópia fica de fora (demo completa)', () => {
    // outra entidade, a entidade da outra versão, outra temporada, outra data e outro site
    expect(exampleHref('pt-BR', '/times/00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(exampleHref('pt-BR', `/times/${AR.time}`)).toBeNull();
    expect(exampleHref('pt-BR', `/times/${BR.time}?temporada=2025`)).toBeNull();
    expect(exampleHref('pt-BR', `/competicoes/${BR.campeonato}?data=2025-05-01`)).toBeNull();
    expect(exampleHref('pt-BR', 'https://exemplo.com/eventos/1')).toBeNull();
    expect(exampleHref('pt-BR', '/esportes/futebol')).toBeNull();
  });

  it('cada versão tem as quatro páginas', () => {
    for (const ids of [BR, AR]) expect(Object.keys(ids).sort()).toEqual([...EXAMPLE_PAGES].sort());
  });
});
