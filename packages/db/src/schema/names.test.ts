import { describe, expect, it } from 'vitest';
import { venueDisplay, venueFormerNames, type VenueCuration } from './core.js';
import { nameKey, sameName } from './names.js';

const curated: VenueCuration = {
  name: 'Nubank Parque',
  city: 'São Paulo',
  nicknames: ['Arena'],
  former_names: [{ name: 'Allianz Parque', until: '2026-05-03' }],
  team_slugs: ['palmeiras'],
  matched_by: 'provider_id',
};

describe('nomes de estádios', () => {
  it('chave sem caixa, acentos, entidades e letras especiais', () => {
    expect(nameKey('Estádio  Cícero-Pompeu')).toBe('estadio cicero pompeu');
    expect(nameKey('Yıldız Stadyumu')).toBe('yildiz stadyumu');
    expect(nameKey('Inter&amp;Co Stadium')).toBe('inter co stadium');
  });

  it('grafias do mesmo nome × troca de nome', () => {
    expect(sameName('MHPArena', 'MHP Arena')).toBe(true);
    expect(sameName('1. FC Nürnberg', 'FC Nurnberg')).toBe(true);
    expect(sameName('Estadio Bellavista de Ambato', 'Estadio Bellavista', 'Ambato')).toBe(true);
    expect(sameName('Toyota Stadium(Texas)', 'Toyota Stadium')).toBe(true);
    expect(sameName('Estadio Do MorumBIS', 'MorumBIS')).toBe(true);
    expect(sameName('Allianz Parque', 'Nubank Parque')).toBe(false);
  });

  it('curadoria vence o fornecedor no nome e nos nomes anteriores', () => {
    const v = {
      name: 'Allianz Parque',
      city: 'São Paulo, São Paulo',
      curated,
      providerFormerNames: [
        { name: 'Allianz Parque', from: '2016-08-31', until: '2025-05-22' },
        { name: 'Palestra Itália', from: '2010-01-01', until: '2010-07-09' },
      ],
    };
    expect(venueDisplay(v)).toEqual({ name: 'Nubank Parque', city: 'São Paulo' });
    expect(venueFormerNames(v)).toEqual([
      { name: 'Allianz Parque', from: null, until: '2026-05-03', origin: 'curated' },
      { name: 'Palestra Itália', from: '2010-01-01', until: '2010-07-09', origin: 'provider' },
    ]);
    // sem curadoria vale o fornecedor
    expect(venueDisplay({ ...v, curated: null })).toEqual({
      name: 'Allianz Parque',
      city: 'São Paulo, São Paulo',
    });
    expect(venueFormerNames({ ...v, curated: null }).map((f) => f.name)).toEqual(['Palestra Itália']);
  });
});
