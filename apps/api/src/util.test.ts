import { describe, expect, it } from 'vitest';
import { logoFormats, logoSizes } from './util.js';

const BASE = 'https://assets.example.test';
const v = (key: string) => ({ storage_key: key });
const sq = (key: string, side: number) => ({ storage_key: key, width: side, height: side });

describe('logo_sizes', () => {
  it('64/128/256 de variants.sizes e o 512 do png/webp do escudo quando ele já é 512×512', () => {
    const variants = {
      svg: v('t/a.svg'),
      png: sq('t/a.png', 512),
      webp: sq('t/a.webp', 512),
      sizes: { '64': { png: v('t/64.png'), webp: v('t/64.webp') }, '256': { png: v('t/256.png') } },
    };
    expect(logoSizes(BASE, variants)).toEqual({
      '64': { png: `${BASE}/t/64.png`, webp: `${BASE}/t/64.webp` },
      '128': null,
      '256': { png: `${BASE}/t/256.png`, webp: null },
      '512': { png: `${BASE}/t/a.png`, webp: `${BASE}/t/a.webp` },
    });
    // logo_formats não muda com os tamanhos
    expect(logoFormats(BASE, variants)).toEqual({
      svg: `${BASE}/t/a.svg`,
      png: `${BASE}/t/a.png`,
      webp: `${BASE}/t/a.webp`,
    });
  });

  it('512 gerado tem prioridade; png/webp que não é 512×512 nunca sai como 512', () => {
    // pacote com o maior PNG de 128: sem 512 (não ampliamos)
    expect(
      logoSizes(BASE, {
        png: sq('t/a.png', 128),
        webp: sq('t/a.webp', 128),
        sizes: { '64': { png: v('t/64.png') } },
      }),
    ).toEqual({ '64': { png: `${BASE}/t/64.png`, webp: null }, '128': null, '256': null, '512': null });
    // retangular de 512 de altura: não é o quadrado prometido
    expect(logoSizes(BASE, { png: { storage_key: 't/a.png', width: 400, height: 512 } })).toBeNull();
    // sem largura e altura gravadas não dá para garantir o 512
    expect(logoSizes(BASE, { png: v('t/a.png') })).toBeNull();
    // maior que 512: vale o 512 gerado em variants.sizes
    expect(
      logoSizes(BASE, {
        png: sq('t/a.png', 1024),
        sizes: { '512': { png: v('t/512.png'), webp: v('t/512.webp') } },
      })?.['512'],
    ).toEqual({ png: `${BASE}/t/512.png`, webp: `${BASE}/t/512.webp` });
  });

  it('512 por formato: PNG do escudo de 512 com o WebP de 512 gerado', () => {
    expect(
      logoSizes(BASE, {
        png: sq('t/a.png', 512),
        webp: sq('t/a.webp', 128),
        sizes: { '512': { webp: v('t/512.webp') } },
      })?.['512'],
    ).toEqual({ png: `${BASE}/t/a.png`, webp: `${BASE}/t/512.webp` });
  });

  it('null fora do acervo, sem storage publicado ou só com SVG', () => {
    expect(logoSizes(BASE, null)).toBeNull();
    expect(logoSizes(undefined, { png: v('t/a.png') })).toBeNull();
    expect(logoSizes(BASE, { svg: v('t/a.svg') } as never)).toBeNull();
  });
});
