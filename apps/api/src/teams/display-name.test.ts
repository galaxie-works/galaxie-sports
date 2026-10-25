import { describe, expect, it } from 'vitest';
import { curatedTeamName, teamDisplayName, teamNameOptions, TeamNamer } from './display-name.js';

const saoPaulo = {
  labels: null,
  names: { official: 'São Paulo Futebol Clube', short: 'São Paulo' },
  reviewStatus: 'approved',
};
const bayern = {
  labels: { 'pt-BR': 'Bayern de Munique', es: 'Bayern Múnich', en: 'Bayern Munich' },
  names: { official: 'FC Bayern München', short: 'Bayern' },
  reviewStatus: 'approved',
};
const pt = { locale: 'pt-BR', minReview: 'draft' } as const;
const esAR = { locale: 'es-AR', minReview: 'draft' } as const;

describe('curatedTeamName', () => {
  it('rótulo do idioma (com a cadeia es-AR → es → en) ou o nome curto', () => {
    expect(curatedTeamName(bayern, 'pt-BR')).toBe('Bayern de Munique');
    expect(curatedTeamName(bayern, 'es-AR')).toBe('Bayern Múnich');
    expect(curatedTeamName(saoPaulo, 'es-AR')).toBe('São Paulo');
    expect(curatedTeamName({ labels: null, names: {} }, 'pt-BR')).toBeNull();
  });
});

describe('teamDisplayName', () => {
  it('time com perfil no piso: o nome curado, em pt-BR e es-AR', () => {
    const src = { name: 'Sao Paulo', countryCode: 'BR', kind: 'club', profile: saoPaulo };
    expect(teamDisplayName(src, pt)).toBe('São Paulo');
    expect(teamDisplayName(src, esAR)).toBe('São Paulo');
    expect(
      teamDisplayName({ name: 'Bayern München', countryCode: 'DE', kind: 'club', profile: bayern }, esAR),
    ).toBe('Bayern Múnich');
  });

  it('perfil abaixo do piso editorial não vale: cai no corretor', () => {
    const draft = { ...saoPaulo, names: { short: 'Tricolor' }, reviewStatus: 'draft' };
    const src = { name: 'Sao Paulo', countryCode: 'BR', kind: 'club', profile: draft };
    expect(teamDisplayName(src, { locale: 'pt-BR', minReview: 'approved' })).toBe('São Paulo');
    expect(teamDisplayName(src, pt)).toBe('Tricolor');
  });

  it('sem perfil: o nome do fornecedor com o corretor (só para times)', () => {
    expect(teamDisplayName({ name: 'Gremio', countryCode: 'BR', kind: 'club' }, pt)).toBe('Grêmio');
    expect(teamDisplayName({ name: 'Leon', countryCode: 'MX', kind: 'club' }, esAR)).toBe('León');
    expect(teamDisplayName({ name: 'Sergio Perez', countryCode: 'MX', kind: 'driver' }, esAR)).toBe(
      'Sergio Perez',
    );
    expect(teamDisplayName({ name: 'Sao Paulo', countryCode: null, kind: 'club' }, pt)).toBe('Sao Paulo');
  });

  it('o piso padrão é o do servidor (approved sem configuração)', () => {
    expect(teamNameOptions({}, 'pt-BR')).toEqual({ locale: 'pt-BR', minReview: 'approved' });
    expect(teamNameOptions({ semantic: { minReviewStatus: 'draft' } }, 'es-AR')).toEqual({
      locale: 'es-AR',
      minReview: 'draft',
    });
  });
});

describe('TeamNamer', () => {
  const namer = new TeamNamer(
    new Map([
      ['a', { kind: 'club', countryCode: 'BR', profile: saoPaulo }],
      ['b', { kind: 'club', countryCode: 'BR', profile: null }],
    ]),
    pt,
  );
  it('nome exibido e o original do fornecedor', () => {
    expect(namer.of('a', 'Sao Paulo')).toEqual({ name: 'São Paulo', provider_name: 'Sao Paulo' });
    expect(namer.of('b', 'Gremio')).toEqual({ name: 'Grêmio', provider_name: 'Gremio' });
  });
  it('participante fora do lote: o nome como veio', () => {
    expect(namer.of('c', 'Sao Paulo')).toEqual({ name: 'Sao Paulo', provider_name: 'Sao Paulo' });
    expect(namer.name(null, 'Gremio')).toBe('Gremio');
  });
});
