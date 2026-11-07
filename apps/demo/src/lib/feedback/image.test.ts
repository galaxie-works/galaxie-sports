import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { cleanImage } from './image';

const photo = (format: 'jpeg' | 'png') => {
  const img = sharp({ create: { width: 40, height: 20, channels: 3, background: '#336699' } }).withExif({
    IFD0: { Make: 'Celular', Artist: 'Fulano' },
    IFD3: { GPSLatitudeRef: 'S' },
  });
  return (format === 'png' ? img.png() : img.jpeg()).toBuffer();
};

describe('imagem anexada', () => {
  it.each(['jpeg', 'png'] as const)('%s sai sem EXIF nem GPS e no mesmo formato', async (format) => {
    const input = await photo(format);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await cleanImage(new Uint8Array(input), format === 'png' ? 'image/png' : 'image/jpeg');
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe(format);
    expect([meta.width, meta.height]).toEqual([40, 20]);
  });

  it('recusa arquivo com assinatura certa e conteúdo quebrado', async () => {
    await expect(
      cleanImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2]), 'image/jpeg'),
    ).rejects.toThrow();
  });
});
