import { describe, expect, it, vi } from 'vitest';

import { fetchFlags } from './country-flags';

describe('bandeiras do CountryFlag', () => {
  it('vêm do catálogo inteiro de países (/v1/countries), não só dos países do menu', async () => {
    const data = [
      { code: 'BR', name: 'Brasil', ioc_code: 'BRA', confederation: 'CONMEBOL', flag: 'https://cdn/br.svg' },
      {
        code: 'nz',
        name: 'Nova Zelândia',
        ioc_code: 'NZL',
        confederation: 'OFC',
        flag: 'https://cdn/nz.svg',
      },
      { code: 'XK', name: 'Kosovo', ioc_code: null, confederation: 'UEFA', flag: null },
    ];
    const fetchImpl = vi.fn(async () => Response.json({ data }));
    expect(await fetchFlags(fetchImpl as unknown as typeof fetch)).toEqual({
      BR: 'https://cdn/br.svg',
      NZ: 'https://cdn/nz.svg',
      XK: null,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/galaxie/v1/countries');
  });

  it('erro da API vira erro da consulta (o chip com o código fica)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 502 }));
    await expect(fetchFlags(fetchImpl as unknown as typeof fetch)).rejects.toThrow('countries 502');
  });
});
