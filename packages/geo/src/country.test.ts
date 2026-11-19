import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGeoConfig } from './config.js';
import {
  COUNTRIES_WITH_FACTS,
  countryCurrency,
  countryFacts,
  referenceTimeZone,
  singleTimeZone,
} from './country.js';

const geo = loadGeoConfig(fileURLToPath(new URL('../../../config/geo/', import.meta.url)));

describe('fuso e moeda por país', () => {
  it('todo mercado e todo país latino-americano do config/geo tem fuso e moeda', () => {
    for (const code of [...geo.markets, ...geo.latamCountries])
      expect(countryFacts(code), code).not.toBeNull();
  });

  it('fusos IANA válidos, moeda no formato ISO 4217 e países conhecidos do geo', () => {
    for (const code of COUNTRIES_WITH_FACTS) {
      const f = countryFacts(code)!;
      expect(() => new Intl.DateTimeFormat('en', { timeZone: f.timeZone }), code).not.toThrow();
      expect(f.currency, code).toMatch(/^[A-Z]{3}$/);
      // GB é o código ISO do Reino Unido (vem do local da partida); no geo os membros são GB-ENG, GB-SCT…
      if (code !== 'GB') expect(geo.country(code), code).toBeTruthy();
    }
  });

  it('EUA e Canadá têm fuso de referência, mas não um fuso só', () => {
    expect(referenceTimeZone('US')).toBe('America/New_York');
    expect(singleTimeZone('us')).toBeNull();
    expect(referenceTimeZone('CA')).toBe('America/Toronto');
    expect(singleTimeZone('CA')).toBeNull();
    expect(singleTimeZone('BR')).toBe('America/Sao_Paulo');
    expect(countryCurrency('EC')).toBe('USD');
    expect(countryCurrency('ZZ')).toBeNull();
    expect(referenceTimeZone(null)).toBeNull();
  });

  it('fixa os valores dos 8 mercados do Onde Assistir e do Panamá (os que a grade já usava)', () => {
    const expected: Record<string, [string, string]> = {
      BR: ['America/Sao_Paulo', 'BRL'],
      AR: ['America/Argentina/Buenos_Aires', 'ARS'],
      MX: ['America/Mexico_City', 'MXN'],
      CO: ['America/Bogota', 'COP'],
      CL: ['America/Santiago', 'CLP'],
      PE: ['America/Lima', 'PEN'],
      UY: ['America/Montevideo', 'UYU'],
      EC: ['America/Guayaquil', 'USD'],
      PA: ['America/Panama', 'USD'],
    };
    for (const [code, [tz, currency]] of Object.entries(expected)) {
      expect(referenceTimeZone(code), code).toBe(tz);
      expect(countryCurrency(code), code).toBe(currency);
    }
  });
});
