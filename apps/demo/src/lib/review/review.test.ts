import { describe, expect, it } from 'vitest';

import { fieldText, parseProposedField, previewFor } from './preview';
import { filtersQuery, parseFilters } from './types';

describe('filtros da URL', () => {
  it('lê só valores conhecidos e normaliza mercado e página', () => {
    expect(
      parseFilters(
        new URLSearchParams('tipo=team&esporte=football&mercado=br&status=needs_review&q=+Verd%C3%A3o+'),
      ),
    ).toEqual({
      kind: 'team',
      sport: 'football',
      market: 'BR',
      locale: null,
      state: 'needs_review',
      q: 'Verdão',
      page: 1,
    });
    expect(parseFilters({ tipo: 'qualquer', status: 'publicado', pagina: '-3' })).toMatchObject({
      kind: null,
      state: null,
      page: 1,
    });
    expect(parseFilters({ pagina: ['4', '9'] }).page).toBe(4);
  });

  it('monta a query só com o que está definido (ida e volta)', () => {
    const filters = parseFilters({ tipo: 'copy', locale: 'es-AR', pagina: '2' });
    expect(filtersQuery(filters)).toBe('?tipo=copy&locale=es-AR&pagina=2');
    expect(parseFilters(new URLSearchParams(filtersQuery(filters).slice(1)))).toEqual(filters);
    expect(filtersQuery({ page: 1 })).toBe('');
  });
});

describe('prévia do que a API serviria', () => {
  it('perfil: campos do TeamSemantic', () => {
    const p = previewFor({
      kind: 'team',
      key: 'palmeiras',
      locale: 'pt-BR',
      market: 'BR',
      parentKind: null,
      content: {
        slug: 'palmeiras',
        names: { official: 'Sociedade Esportiva Palmeiras', short: 'Palmeiras', abbreviation: 'PAL' },
        nicknames: ['Verdão'],
        rallying_cries: ['Avanti, Palestra!'],
        fans: { demonym: 'palmeirense' },
      },
    });
    expect(p.endpoint).toBe('GET /v1/teams/palmeiras/semantic');
    expect(p.body).toMatchObject({
      slug: 'palmeiras',
      country: 'BR',
      name: 'Palmeiras',
      abbreviation: 'PAL',
      nicknames: ['Verdão'],
      rallying_cries: ['Avanti, Palestra!'],
      fans: { demonym: 'palmeirense', group_nicknames: [] },
      stadium: null,
    });
  });

  it('tradução: só os campos traduzidos, no locale dela', () => {
    const p = previewFor({
      kind: 'translation',
      key: 'derby:choque-rei',
      locale: 'es',
      market: null,
      parentKind: 'derby',
      content: { origin: 'Origen', trivia: ['Dato'], note: 'interna' },
    });
    expect(p).toEqual({
      endpoint: 'GET /v1/derbies/choque-rei?locale=es',
      body: { origin: 'Origen', trivia: ['Dato'], text_locale: 'es' },
    });
  });

  it('glossário: o termo como em GET /v1/glossary, aprovado', () => {
    const p = previewFor({
      kind: 'glossary',
      key: 'pt-BR.secar',
      locale: 'pt-BR',
      market: 'BR',
      parentKind: null,
      content: { key: 'secar', term: 'secar', meaning: 'Torcer contra.', category: 'rivalry', sources: [] },
    });
    expect(p.endpoint).toBe('GET /v1/glossary?locale=pt-BR');
    expect(p.body).toMatchObject({
      key: 'secar',
      requires: null,
      copy_intents: [],
      review_status: 'approved',
    });
  });
});

describe('edição proposta campo a campo', () => {
  it('converte para o tipo do original e ignora o que não mudou', () => {
    expect(parseProposedField(['Verdão', 'Porco'], 'Verdão\n Porco \n\nPalestra')).toEqual([
      'Verdão',
      'Porco',
      'Palestra',
    ]);
    expect(parseProposedField(['Verdão'], 'Verdão\n')).toBeUndefined();
    expect(parseProposedField(4, '5')).toBe(5);
    expect(() => parseProposedField(4, 'cinco')).toThrow(SyntaxError);
    expect(parseProposedField({ demonym: 'a' }, '{"demonym":"b"}')).toEqual({ demonym: 'b' });
    expect(() => parseProposedField({ demonym: 'a' }, '{demonym')).toThrow(SyntaxError);
    expect(parseProposedField('Porco', ' Porco ')).toBeUndefined();
    expect(parseProposedField(null, '')).toBeUndefined();
    expect(parseProposedField('Porco', '')).toBeNull();
  });

  it('fieldText é o inverso para listas, objetos e textos', () => {
    expect(fieldText(['a', 'b'])).toBe('a\nb');
    expect(JSON.parse(fieldText({ x: 1 }))).toEqual({ x: 1 });
    expect(fieldText(null)).toBe('');
    for (const v of [['a', 'b'], { x: [1] }, 'texto', 3])
      expect(parseProposedField(v, fieldText(v))).toBeUndefined();
  });
});
