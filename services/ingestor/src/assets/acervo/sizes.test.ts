import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sizedLogos } from './sizes.js';

/** PNG retangular com transparência (escudo mais alto que largo). */
async function png(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 10, b: 40, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe('tamanhos fixos do acervo', () => {
  it('do PNG de 512 saem PNG e WebP em 64, 128 e 256, quadrados e com transparência', async () => {
    const out = await sizedLogos(await png(400, 512));
    expect(out.map((o) => `${o.size}.${o.format}`)).toEqual([
      '64.png',
      '64.webp',
      '128.png',
      '128.webp',
      '256.png',
      '256.webp',
    ]);
    for (const o of out) {
      const meta = await sharp(o.body).metadata();
      expect(meta.format).toBe(o.format);
      expect([meta.width, meta.height]).toEqual([o.size, o.size]);
      expect(meta.hasAlpha).toBe(true);
    }
    // o escudo é encaixado sem corte: a sobra lateral é transparente
    const { data, info } = await sharp(out[4]!.body).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect(data[(info.height / 2) * info.width * 4 + (info.width / 2) * 4 + 3]).toBe(255);
  });

  it('não amplia um PNG menor que o tamanho', async () => {
    const out = await sizedLogos(await png(100, 100));
    expect([...new Set(out.map((o) => o.size))]).toEqual([64]);
  });
});
