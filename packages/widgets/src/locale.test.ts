import { describe, expect, it } from 'vitest';

import { apiLocale, intlLocale } from './core/model.js';
import { createPreviewFetch } from './fixtures.js';
import { localizeSample } from './fixtures-locale.js';

describe('apiLocale', () => {
  it('manda o locale de cada idioma para a API (inglês incluso)', () => {
    expect(apiLocale('pt-BR')).toBe('pt-BR');
    expect(apiLocale('en')).toBe('en');
    expect(apiLocale('en', 'US')).toBe('en');
  });

  it('o espanhol segue o mercado, com es-AR fora dos mercados', () => {
    expect(apiLocale('es', 'mx')).toBe('es-MX');
    expect(apiLocale('es', 'BR')).toBe('es-AR');
    expect(apiLocale('es')).toBe('es-AR');
  });

  it('intlLocale usa a variante do mercado só no espanhol', () => {
    expect(intlLocale('es', 'CL')).toBe('es-CL');
    expect(intlLocale('en', 'BR')).toBe('en');
    expect(intlLocale('pt-BR')).toBe('pt-BR');
  });
});

describe('dados de exemplo no idioma do widget', () => {
  const get = async (locale?: string) => {
    const fetchImpl = createPreviewFetch();
    const qs = locale ? `?locale=${locale}` : '';
    const res = await fetchImpl(`https://api.exemplo.test/v1/events${qs}`);
    return (await res.json()) as {
      data: { competition: { name: string }; stage: { name: string }; venue: { name: string } }[];
    };
  };

  it('em pt-BR (ou sem locale) ficam como estão', async () => {
    for (const body of [await get('pt-BR'), await get()]) {
      expect(body.data[0]?.competition.name).toBe('Liga Exemplo');
      expect(body.data[0]?.stage.name).toBe('Rodada 12');
    }
  });

  it('em inglês e espanhol saem traduzidos, como a API real com ?locale', async () => {
    const en = await get('en');
    expect(en.data[0]?.competition.name).toBe('Sample League');
    expect(en.data[0]?.stage.name).toBe('Matchday 12');
    expect(en.data[0]?.venue.name).toBe('Sample Arena');
    const es = await get('es-AR');
    expect(es.data[0]?.competition.name).toBe('Liga Ejemplo');
    expect(es.data[0]?.stage.name).toBe('Fecha 12');
  });

  it('localizeSample só troca textos inteiros conhecidos', () => {
    expect(localizeSample({ a: 'Liga Exemplo', b: ['Rodada 3', 'Aurora'], n: 1 }, 'en')).toEqual({
      a: 'Sample League',
      b: ['Matchday 3', 'Aurora'],
      n: 1,
    });
  });
});
