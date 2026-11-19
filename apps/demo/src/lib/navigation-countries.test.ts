import { describe, expect, it, vi } from 'vitest';

import { fetchNavigationCountries } from './navigation-countries';

describe('países do menu lateral', () => {
  it('vêm de /v1/navigation (do banco), com o nome no idioma pedido e a confederação', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        sports: [],
        countries: [
          { code: 'BR', name: 'Brasil', flag: null, confederation: { code: 'CONMEBOL', name: 'CONMEBOL' } },
          {
            code: 'US',
            name: 'Estados Unidos',
            flag: null,
            confederation: { code: 'CONCACAF', name: 'CONCACAF' },
          },
          { code: 'NL', name: 'Holanda', flag: null, confederation: { code: 'UEFA', name: 'UEFA' } },
        ],
        confederations: [],
      }),
    );
    const countries = await fetchNavigationCountries(fetchImpl as unknown as typeof fetch, 'pt-BR');
    expect(fetchImpl).toHaveBeenCalledWith('/api/galaxie/v1/navigation?locale=pt-BR');
    expect(countries).toEqual([
      { code: 'BR', group: 'CONMEBOL', href: '/countries/br', name: 'Brasil' },
      { code: 'US', group: 'CONCACAF', href: '/countries/us', name: 'Estados Unidos' },
      { code: 'NL', group: 'UEFA', href: '/countries/nl', name: 'Holanda' },
    ]);
  });

  it('erro da API sobe (o menu fica com a lista de reserva)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    await expect(fetchNavigationCountries(fetchImpl as unknown as typeof fetch, 'es')).rejects.toThrow(
      'navigation 503',
    );
  });
});
