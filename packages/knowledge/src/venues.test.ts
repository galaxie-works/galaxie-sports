import { describe, expect, it } from 'vitest';
import { curationOf, nameVariants, stadiumMatches } from './venues.js';
import type { StadiumEntry } from './types.js';

const palmeiras: StadiumEntry = {
  name: 'Nubank Parque',
  nicknames: ['Arena'],
  former_names: [{ name: 'Allianz Parque', until: '2026-05-03' }],
  city: 'São Paulo',
};
const saoPaulo: StadiumEntry = {
  name: 'MorumBIS',
  nicknames: ['Morumbi', 'Estádio Cícero Pompeu de Toledo'],
  city: 'São Paulo',
};

describe('estádios curados', () => {
  it('variantes do nome do fornecedor', () => {
    expect(nameVariants('Estádio Cícero Pompeu de Toledo (Morumbi)')).toEqual([
      'estadio cicero pompeu de toledo morumbi',
      'estadio cicero pompeu de toledo',
      'morumbi',
      'cicero pompeu de toledo morumbi',
      'cicero pompeu de toledo',
    ]);
  });

  it('casa por nome atual, apelido ou nome anterior e confere a cidade', () => {
    const allianz = { name: 'Allianz Parque', city: 'São Paulo, São Paulo', provider_former_names: null };
    expect(stadiumMatches(palmeiras, allianz)).toBe(true);
    expect(stadiumMatches(palmeiras, { ...allianz, city: 'Campinas' })).toBe(false);
    expect(stadiumMatches(palmeiras, { ...allianz, name: 'Allianz Arena', city: 'München' })).toBe(false);
    expect(
      stadiumMatches(saoPaulo, {
        name: 'Estádio Cícero Pompeu de Toledo (Morumbi)',
        city: 'São Paulo, São Paulo',
        provider_former_names: null,
      }),
    ).toBe(true);
    expect(stadiumMatches(saoPaulo, { name: 'MorumBIS', city: null, provider_former_names: null })).toBe(
      true,
    );
    // nome novo no fornecedor; o antigo veio do histórico de jogos
    expect(
      stadiumMatches(
        { name: 'Arena Nova', city: 'Recife' },
        {
          name: 'Arena Patrocinada',
          city: 'Recife',
          provider_former_names: [{ name: 'Arena Nova', from: '2015-01-01', until: '2025-12-01' }],
        },
      ),
    ).toBe(true);
  });

  it('curadoria guarda nomes anteriores do mais recente ao mais antigo', () => {
    const c = curationOf(
      {
        ...palmeiras,
        former_names: [
          { name: 'A', until: '2010-01-01' },
          { name: 'B', until: '2020-01-01' },
        ],
      },
      ['palmeiras'],
      'provider_id',
    );
    expect(c).toMatchObject({ name: 'Nubank Parque', city: 'São Paulo', matched_by: 'provider_id' });
    expect(c.former_names.map((f) => f.name)).toEqual(['B', 'A']);
  });
});
