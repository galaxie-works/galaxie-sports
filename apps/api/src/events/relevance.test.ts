import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadGeoConfig } from '@galaxie/geo';
import {
  continentalSlugs,
  importanceBreakdownDto,
  inMarket,
  marketBonus,
  resolveMarket,
} from './relevance.js';

const geo = loadGeoConfig();
const continental = (market: string) =>
  new Set(continentalSlugs(geo, market).map((c) => `${c.sport}|${c.slug}`));

const lib = { sport: 'football', slug: 'conmebol-libertadores', countryCode: 'WORLD' };
const bra = { sport: 'football', slug: 'brasileirao-serie-a', countryCode: 'BR' };
const ucl = { sport: 'football', slug: 'uefa-champions-league', countryCode: 'WORLD' };
const wc = { sport: 'football', slug: 'fifa-world-cup', countryCode: 'WORLD' };

describe('marketBonus', () => {
  it('semifinal da Libertadores entre brasileiros no mercado BR: +10 (teto)', () => {
    expect(
      marketBonus('BR', { participantCountries: ['BR', 'BR'], competition: lib }, continental('BR')),
    ).toEqual({
      bonus: 10,
      reasons: ['team_from_market', 'continental_competition'],
    });
  });

  it('Libertadores sem brasileiro no mercado BR: +5 da confederação', () => {
    expect(
      marketBonus('BR', { participantCountries: ['AR', 'EC'], competition: lib }, continental('BR')),
    ).toEqual({
      bonus: 5,
      reasons: ['continental_competition'],
    });
  });

  it('Brasileirão no mercado BR: +10; no AR: nada', () => {
    expect(
      marketBonus('BR', { participantCountries: ['BR', 'BR'], competition: bra }, continental('BR')).bonus,
    ).toBe(10);
    expect(
      marketBonus('AR', { participantCountries: ['BR', 'BR'], competition: bra }, continental('AR')),
    ).toEqual({
      bonus: 0,
      reasons: [],
    });
  });

  it('Champions no mercado BR não ganha bônus; no ES ganha +5', () => {
    expect(
      marketBonus('BR', { participantCountries: ['ES', 'DE'], competition: ucl }, continental('BR')).bonus,
    ).toBe(0);
    expect(
      marketBonus('ES', { participantCountries: ['IT', 'DE'], competition: ucl }, continental('ES')).bonus,
    ).toBe(5);
  });

  it('competição global (Copa do Mundo) não diferencia mercados', () => {
    expect(continental('BR').has('football|fifa-world-cup')).toBe(false);
    expect(
      marketBonus('BR', { participantCountries: ['FR', 'DE'], competition: wc }, continental('BR')).bonus,
    ).toBe(0);
  });

  it('convidado listado em `countries` (Copa América no mercado MX)', () => {
    expect(continental('MX').has('football|copa-america')).toBe(true);
  });

  it('GB cobre os códigos GB-ENG/GB-SCT', () => {
    expect(inMarket('GB-ENG', 'GB')).toBe(true);
    expect(inMarket('BR', 'GB')).toBe(false);
    expect(continental('GB').has('football|uefa-champions-league')).toBe(true);
  });
});

describe('resolveMarket', () => {
  const req = (markets: string[] | null) =>
    ({ tenant: markets ? { markets } : null }) as unknown as FastifyRequest;

  it('market explícito vence; senão o único mercado do plano; senão nenhum', () => {
    expect(resolveMarket(req(['AR']), 'br')).toBe('BR');
    expect(resolveMarket(req(['ar']), undefined)).toBe('AR');
    expect(resolveMarket(req(['AR', 'BR']), undefined)).toBeNull();
    expect(resolveMarket(req([]), undefined)).toBeNull();
    expect(resolveMarket(req(null), undefined)).toBeNull();
  });
});

describe('importanceBreakdownDto', () => {
  it('omite os campos internos e sinais desconhecidos', () => {
    expect(
      importanceBreakdownDto({
        tier: 40,
        phase: 22,
        derby: 0,
        decisive: 8,
        prestige: 10,
        leg: 2,
        flags: ['elimination', 'x'],
        stake_flags: [],
      }),
    ).toEqual({ tier: 40, phase: 22, derby: 0, decisive: 8, prestige: 10, flags: ['elimination'] });
    expect(importanceBreakdownDto(null)).toBeNull();
  });
});
