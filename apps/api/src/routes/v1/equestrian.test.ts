import { describe, expect, it } from 'vitest';
import { countryRef, notice, type CountryInfo } from './equestrian.js';

describe('notice', () => {
  it('a categoria fica fora da oferta comercial, com a licença do lote e texto no idioma pedido', () => {
    const pt = notice('pt-BR', 'fei_public_pages_unlicensed');
    expect(pt.commercial).toBe(false);
    expect(pt.license).toBe('fei_public_pages_unlicensed');
    expect(pt.message).toMatch(/não faz parte das ofertas da Galaxie/);
    expect(notice('es-AR', null)).toMatchObject({ license: 'unknown', commercial: false });
    expect(notice('es-AR', null).message).toMatch(/no forma parte de la oferta/);
  });
});

describe('countryRef', () => {
  const map = new Map<string, CountryInfo>([
    ['ARG', { iso2: 'AR', name: { 'pt-BR': 'Argentina', es: 'Argentina' }, flag: 'https://cdn/ar.svg' }],
  ]);

  it('resolve o código FEI/COI para ISO, nome e bandeira', () => {
    expect(countryRef(map, 'ARG', 'pt-BR')).toEqual({
      code: 'ARG',
      iso2: 'AR',
      name: 'Argentina',
      flag_url: 'https://cdn/ar.svg',
    });
  });

  it('sem equivalência, mantém o código publicado; sem código, null', () => {
    expect(countryRef(map, 'XYZ', 'pt-BR')).toEqual({ code: 'XYZ', iso2: null, name: null, flag_url: null });
    expect(countryRef(map, null, 'pt-BR')).toBeNull();
  });
});
