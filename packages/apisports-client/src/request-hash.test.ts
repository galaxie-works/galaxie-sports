import { describe, expect, it } from 'vitest';
import { normalizeParams, requestHash } from './request-hash.js';

describe('normalizeParams', () => {
  it('ordena chaves, converte para string e remove vazios', () => {
    expect(normalizeParams({ season: 2024, league: 71, round: undefined, team: '' })).toEqual({
      league: '71',
      season: '2024',
    });
  });
});

describe('requestHash', () => {
  it('não depende da ordem dos parâmetros', () => {
    const a = requestHash('api-sports', 'football', '/fixtures', { league: 71, season: 2024 });
    const b = requestHash('api-sports', 'football', '/fixtures', { season: '2024', league: '71' });
    expect(a).toBe(b);
  });

  it('distingue esporte e endpoint', () => {
    const base = requestHash('api-sports', 'football', '/fixtures', { date: '2026-10-21' });
    expect(requestHash('api-sports', 'basketball', '/fixtures', { date: '2026-10-21' })).not.toBe(base);
    expect(requestHash('api-sports', 'football', '/injuries', { date: '2026-10-21' })).not.toBe(base);
  });
});
