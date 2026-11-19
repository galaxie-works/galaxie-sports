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
  it('do PNG retangular de 512 saem PNG e WebP em 64, 128, 256 e 512, quadrados e com transparência', async () => {
    const out = await sizedLogos(await png(400, 512));
    expect(out.map((o) => `${o.size}.${o.format}`)).toEqual([
      '64.png',
      '64.webp',
      '128.png',
      '128.webp',
      '256.png',
      '256.webp',
      '512.png',
      '512.webp',
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

  it('PNG quadrado de 512 não é refeito no 512; maior que 512 ganha o 512', async () => {
    expect([...new Set((await sizedLogos(await png(512, 512))).map((o) => o.size))]).toEqual([64, 128, 256]);
    const big = await sizedLogos(await png(1024, 800));
    expect([...new Set(big.map((o) => o.size))]).toEqual([64, 128, 256, 512]);
    const meta = await sharp(big.find((o) => o.size === 512)!.body).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  it('não amplia um PNG menor que o tamanho', async () => {
    const out = await sizedLogos(await png(100, 100));
    expect([...new Set(out.map((o) => o.size))]).toEqual([64]);
  });
});
