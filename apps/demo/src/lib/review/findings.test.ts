import { describe, expect, it } from 'vitest';

import { fieldText, findingCounts, findingsByField, findingsOf, segments } from './findings';

const bio = 'Voltou ao cockpit 39 dias depois. Venceu em casa [S1] com o câmbio travado na sexta marcha.';
const content = {
  bio: { text: bio, sources: ['https://pt.wikipedia.org/wiki/Niki_Lauda', 'https://fora.invalid/x'] },
  moments: [{ year: 1976, round: 10, race: 'GP da Alemanha', text: 'Acidente em Nürburgring.' }],
  findings: [
    {
      field: 'bio',
      start: 0,
      end: 33,
      rule: 'unknown_number',
      reason: 'número fora do F1DB (39)',
      severity: 'severe',
    },
    {
      field: 'bio',
      start: 49,
      end: 53,
      rule: 'citation_marker',
      reason: 'marcador de citação no texto',
      severity: 'alert',
    },
    {
      field: 'bio.sources[1]',
      start: 0,
      end: 22,
      rule: 'source_not_grounded',
      reason: 'fonte que não veio da busca',
      severity: 'severe',
    },
    {
      field: 'moments[0]',
      start: 0,
      end: 24,
      rule: 'race_not_driven',
      reason: 'corrida que o piloto não disputou',
      severity: 'severe',
    },
    { field: 'bio', start: 'x', reason: 3 },
  ],
};

describe('achados do validador (perfil editorial)', () => {
  it('lê os achados bem formados e conta o selo', () => {
    expect(findingsOf(content)).toHaveLength(4);
    expect(findingCounts(content)).toEqual({ alert: 1, severe: 3 });
    expect(findingCounts({ bio: { text: 'x' } })).toBeNull();
  });

  it('o texto do campo: bio, momento e a fonte apontada', () => {
    expect(fieldText(content, 'bio')).toBe(bio);
    expect(fieldText(content, 'moments[0]')).toBe('Acidente em Nürburgring.');
    expect(fieldText(content, 'bio.sources[1]')).toBe('https://fora.invalid/x');
    expect(fieldText(content, 'rivalries[0]')).toBeNull();
  });

  it('destaca os trechos com a gravidade; o resto do texto fica sem marca', () => {
    const segs = segments(
      bio,
      findingsOf(content).filter((f) => f.field === 'bio'),
    );
    expect(segs.map((s) => [s.text, s.severity])).toEqual([
      ['Voltou ao cockpit 39 dias depois.', 'severe'],
      [' Venceu em casa ', null],
      ['[S1]', 'alert'],
      [' com o câmbio travado na sexta marcha.', null],
    ]);
    expect(segs.map((s) => s.text).join('')).toBe(bio);
  });

  it('agrupa por campo na ordem do perfil', () => {
    expect(findingsByField(findingsOf(content)).map(([f]) => f)).toEqual([
      'bio',
      'bio.sources[1]',
      'moments[0]',
    ]);
  });
});
