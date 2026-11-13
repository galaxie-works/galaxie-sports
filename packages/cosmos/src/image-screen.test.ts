import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { localImageScreener } from './image-screen-local.js';
import { SCREEN_LIMITS, screenOutcome, type ImageScores } from './image-screen.js';

const scores = (over: Partial<ImageScores>): ImageScores => ({
  neutral: 0,
  drawing: 0,
  sexy: 0,
  porn: 0,
  hentai: 0,
  ...over,
});

describe('screenOutcome (#1025)', () => {
  it('nu claro segura, mesmo fora do destino infantil; desenho explícito também', () => {
    expect(screenOutcome(scores({ porn: 0.9, neutral: 0.1 }), false)).toBe('held');
    expect(screenOutcome(scores({ hentai: 0.5, porn: 0.4, drawing: 0.1 }), false)).toBe('held');
    expect(screenOutcome(scores({ porn: SCREEN_LIMITS.holdExplicit }), true)).toBe('held');
  });

  it('imagem comum clara libera; no destino infantil, vai para a Cosmos', () => {
    const plain = scores({ neutral: 0.95, drawing: 0.04, sexy: 0.005, porn: 0.005 });
    expect(screenOutcome(plain, false)).toBe('clear');
    expect(screenOutcome(plain, true)).toBe('doubt');
  });

  it('sugestivo ou um pouco de explícito é dúvida: vai para a Cosmos', () => {
    expect(screenOutcome(scores({ neutral: 0.9, sexy: 0.08, porn: 0.02 }), false)).toBe('doubt');
    expect(screenOutcome(scores({ neutral: 0.95, porn: 0.04, sexy: 0.01 }), false)).toBe('doubt');
    expect(screenOutcome(scores({ neutral: 0.5, porn: 0.5 }), false)).toBe('doubt');
  });
});

describe('localImageScreener', () => {
  const solid = async (channels: 1 | 3 | 4, format: 'png' | 'jpeg' | 'webp') => {
    const base = sharp({
      create: {
        width: 320,
        height: 240,
        channels: channels === 1 ? 3 : channels,
        background: { r: 20, g: 110, b: 60, alpha: 1 },
      },
    });
    const encoded = await (
      format === 'png' ? base.png() : format === 'jpeg' ? base.jpeg() : base.webp()
    ).toBuffer();
    return channels === 1 ? sharp(encoded).grayscale().png().toBuffer() : encoded;
  };

  it('lê JPEG, PNG com transparência, WebP e cinza; as notas somam 1', async () => {
    for (const img of [
      await solid(3, 'jpeg'),
      await solid(4, 'png'),
      await solid(3, 'webp'),
      await solid(1, 'png'),
    ]) {
      const s = await localImageScreener(new Uint8Array(img));
      expect(s).not.toBeNull();
      const total = Object.values(s!).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 2);
    }
  }, 60_000);

  it('arquivo que não abre devolve null (a imagem vai para a Cosmos)', async () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(await localImageScreener(broken)).toBeNull();
  }, 60_000);
});
