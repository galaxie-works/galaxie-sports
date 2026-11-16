import { describe, expect, it } from 'vitest';

import { billingFor, isValidSlug, normalizeBrandColor, normalizeName, slugFromName } from './organization';

describe('regras do assistente de criação da organização', () => {
  it('Brasil fatura pela Ltda em reais; os outros mercados pela LLC em dólares (PL8)', () => {
    expect(billingFor('BR')).toEqual({ currency: 'brl', billingEntity: 'ltda' });
    expect(billingFor('AR')).toEqual({ currency: 'usd', billingEntity: 'llc' });
    expect(billingFor('MX')).toEqual({ currency: 'usd', billingEntity: 'llc' });
  });

  it('identificador a partir do nome, no formato da API', () => {
    expect(slugFromName('Clube do Remo')).toBe('clube-do-remo');
    expect(slugFromName('  Operadora Ação & Cia.  ')).toBe('operadora-acao-cia');
    expect(slugFromName('Ñandú TV')).toBe('nandu-tv');
    expect(isValidSlug(slugFromName('Clube do Remo'))).toBe(true);
    expect(isValidSlug('a')).toBe(false);
    expect(isValidSlug('-abc')).toBe(false);
    expect(isValidSlug('Abc')).toBe(false);
  });

  it('nome e cor normalizados', () => {
    expect(normalizeName('  Minha   Marca ')).toBe('Minha Marca');
    expect(normalizeName('x')).toBeNull();
    expect(normalizeName('a'.repeat(121))).toBeNull();
    expect(normalizeBrandColor(' #1E90FF ')).toBe('#1e90ff');
    expect(normalizeBrandColor('#fff')).toBeNull();
    expect(normalizeBrandColor('blue')).toBeNull();
  });
});
