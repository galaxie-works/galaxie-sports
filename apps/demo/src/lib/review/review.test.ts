import { describe, expect, it } from 'vitest';

import { fieldText, parseProposedField, previewFor } from './preview';
import { reviewSummary } from './summary';
import { filtersQuery, floorsFrom, parseFilters, servedAt } from './types';

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

  it('perfil editorial da F1: o perfil como em GET /v1/teams/{slug}/editorial, no idioma do item', () => {
    const p = previewFor({
      kind: 'editorial',
      key: 'es.f1-ayrton-senna',
      locale: 'es',
      market: null,
      parentKind: null,
      content: {
        slug: 'f1-ayrton-senna',
        name: 'Ayrton Senna',
        f1db: { id: 'ayrton-senna' },
        tier: 'legend',
        bio: { text: 'Tricampeão mundial.', sources: ['https://pt.wikipedia.org/wiki/Ayrton_Senna'] },
        style: { kind: 'aggressive', text: 'No limite.', sources: ['https://x'] },
        moments: [
          {
            year: 1993,
            round: 3,
            race: 'GP da Europa',
            wet: true,
            text: 'Venceu sob chuva.',
            source: 'https://y',
          },
        ],
      },
    });
    expect(p.endpoint).toBe('GET /v1/teams/f1-ayrton-senna/editorial?locale=es');
    expect(p.body).toMatchObject({
      tier: 'legend',
      text_locale: 'es',
      style: { kind: 'aggressive' },
      strengths: [],
      moments: [{ year: 1993, race: 'GP da Europa', wet: true }],
      rivalries: [],
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

describe('servido hoje', () => {
  it('a API serve status igual ou acima do piso; sugestão em aberto conta como rascunho', () => {
    expect(servedAt('draft', 'draft')).toBe(true);
    expect(servedAt('needs_review', 'draft')).toBe(true);
    expect(servedAt('needs_review', 'reviewed')).toBe(false);
    expect(servedAt('reviewed', 'approved')).toBe(false);
    expect(servedAt('approved', 'approved')).toBe(true);
  });

  it('o cliente só endurece: pisos possíveis a partir do piso do servidor', () => {
    expect(floorsFrom('draft')).toEqual(['draft', 'reviewed', 'approved']);
    expect(floorsFrom('approved')).toEqual(['approved']);
    expect(floorsFrom(null)).toEqual(['draft', 'reviewed', 'approved']);
  });
});

describe('o que revisar (resumo da lista)', () => {
  const words = { matches: '{count} jogos', draws: '{count} empates' };

  it('perfil editorial: a bio, o estilo e os momentos com ano e corrida', () => {
    expect(
      reviewSummary(
        'editorial',
        {
          slug: 'f1-ayrton-senna',
          name: 'Ayrton Senna',
          f1db: { id: 'ayrton-senna' },
          tier: 'legend',
          bio: { text: 'Tricampeão mundial.', sources: ['https://pt.wikipedia.org/wiki/Ayrton_Senna'] },
          style: { kind: 'aggressive', text: 'No limite.', sources: ['https://x'] },
          moments: [
            {
              year: 1993,
              round: 3,
              race: 'GP da Europa',
              wet: true,
              text: 'Venceu sob chuva.',
              source: 'https://y',
            },
          ],
        },
        words,
      ),
    ).toBe('Tricampeão mundial. · No limite. · 1993 GP da Europa: Venceu sob chuva.');
  });

  it('glossário: termo, significado, exemplo e nota', () => {
    expect(
      reviewSummary(
        'glossary',
        {
          key: 'secar',
          term: 'secar',
          meaning: 'Torcer contra o rival.',
          example: 'Dia de secar!',
          note: 'Uso lúdico.',
          sources: ['https://x'],
        },
        words,
      ),
    ).toBe('secar: Torcer contra o rival. · Dia de secar! · Uso lúdico.');
  });

  it('histórico geral: placar agregado com as palavras do idioma', () => {
    expect(
      reviewSummary(
        'all-time',
        {
          teams: ['liverpool', 'everton'],
          all_time: {
            matches: 248,
            draws: 78,
            basis: 'official',
            as_of: '2026-04-19',
            teams: [
              { team: 'liverpool', wins: 102 },
              { team: 'everton', wins: 68 },
            ],
          },
        },
        words,
      ),
    ).toBe('248 jogos: liverpool 102, everton 68, 78 empates · official · 2026-04-19');
  });

  it('tradução: todo o texto, sem identificadores nem fontes, e corta textos longos', () => {
    expect(
      reviewSummary(
        'translation',
        { slug: 'x', colors: ['verde', 'blanco'], mascot: 'Periquito', sources: ['https://y'] },
        words,
      ),
    ).toBe('verde · blanco · Periquito');
    const long = reviewSummary('copy', { template: 'a'.repeat(900) }, words);
    expect(long).toHaveLength(600);
    expect(long.endsWith('…')).toBe(true);
  });
});
