import { describe, expect, it } from 'vitest';
import { logoFormats, logoSizes } from './util.js';

const BASE = 'https://assets.example.test';
const v = (key: string) => ({ storage_key: key });

describe('logo_sizes', () => {
  it('64/128/256 de variants.sizes e o 512 do png/webp do escudo', () => {
    const variants = {
      svg: v('t/a.svg'),
      png: v('t/a.png'),
      webp: v('t/a.webp'),
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

  it('null fora do acervo, sem storage publicado ou só com SVG', () => {
    expect(logoSizes(BASE, null)).toBeNull();
    expect(logoSizes(undefined, { png: v('t/a.png') })).toBeNull();
    expect(logoSizes(BASE, { svg: v('t/a.svg') } as never)).toBeNull();
  });
});
