import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CrestError, crestStorageKey, prepareCrest } from './prepare.js';

const TEAM = '0190a1b2-0000-7000-8000-000000000001';
const svg = (inner: string, attrs = 'viewBox="0 0 100 120"') =>
  new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`);
const CREST = svg(
  '<path d="M0 0h100v80l-50 40-50-40z" fill="#0b6e2f"/><circle cx="50" cy="45" r="20" fill="#f2c200"/>',
);

async function png(side: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 200, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe('prepareCrest', () => {
  it('SVG: serve o SVG e monta PNG/WebP de 512, os tamanhos fixos e a paleta', async () => {
    const c = await prepareCrest('team', TEAM, CREST);
    expect(c.contentType).toBe('image/svg+xml');
    expect(c.storageKey).toBe(crestStorageKey('team', TEAM, c.sha256, 'image/svg+xml'));
    expect(c.storageKey).toMatch(new RegExp(`^acervo/football/teams/${TEAM}\\.[0-9a-f]{12}\\.svg$`));
    expect(c.variants.svg?.storage_key).toBe(c.storageKey);
    // proporção mantida: 100×120 encaixado em 512×512 com sobra transparente
    expect(c.variants.png).toMatchObject({ width: 512, height: 512 });
    expect(c.variants.webp?.storage_key).toMatch(/\.webp$/);
    expect(Object.keys(c.variants.sizes ?? {})).toEqual(['64', '128', '256']);
    expect(c.variants.sizes?.['64']?.webp?.width).toBe(64);
    expect(c.palette?.dominant).toBeTruthy();
    // tudo o que as variantes citam vai para o storage, sem chave repetida
    const keys = c.objects.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(3 + 6);
    const meta = await sharp(c.objects.find((o) => o.key === c.variants.png!.storage_key)!.body).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  it('competição vai para leagues/', async () => {
    const c = await prepareCrest('competition', 'c1', CREST);
    expect(c.storageKey).toMatch(/^acervo\/football\/leagues\/c1\./);
  });

  it('PNG grande: reduz para 512 e serve o PNG', async () => {
    const c = await prepareCrest('team', TEAM, await png(1200));
    expect(c.contentType).toBe('image/png');
    expect(c.variants.svg).toBeUndefined();
    expect(c.variants.png).toMatchObject({ width: 512, height: 512, storage_key: c.storageKey });
    expect(c.palette?.dominant).toBeTruthy();
  });

  it('PNG de 200 px: não amplia, centraliza numa tela de 512 quadrada', async () => {
    const c = await prepareCrest('team', TEAM, await png(200));
    expect(c.variants.png).toMatchObject({ width: 512, height: 512 });
    const body = c.objects.find((o) => o.key === c.variants.png!.storage_key)!.body;
    const { data, info } = await sharp(body).raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alpha(0, 0)).toBe(0); // sobra transparente
    expect(alpha(256, 256)).toBe(255); // o escudo, no tamanho original, no centro
    expect(alpha(156, 256)).toBe(255);
    expect(alpha(150, 256)).toBe(0);
  });

  it('PNG retangular: 512×512 com sobra transparente', async () => {
    const wide = new Uint8Array(
      await sharp({
        create: { width: 1000, height: 500, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
      })
        .png()
        .toBuffer(),
    );
    const c = await prepareCrest('team', TEAM, wide);
    expect(c.variants.png).toMatchObject({ width: 512, height: 512 });
    expect(c.variants.webp).toMatchObject({ width: 512, height: 512 });
  });

  it('WebP é aceito', async () => {
    const webp = new Uint8Array(
      await sharp(await png(300))
        .webp()
        .toBuffer(),
    );
    const c = await prepareCrest('team', TEAM, webp);
    expect(c.contentType).toBe('image/png');
    expect(c.variants.webp).toBeTruthy();
  });

  it.each([
    ['vazio', new Uint8Array(), 'empty'],
    ['texto', new TextEncoder().encode('olá'), 'unsupported_type'],
    ['SVG com script', svg('<script>alert(1)</script><path d="M0 0h10v10z"/>'), 'unsafe_svg'],
    ['SVG com href externo', svg('<image href="https://x.y/a.png"/>'), 'unsafe_svg'],
  ] as const)('recusa %s', async (_, body, code) => {
    await expect(prepareCrest('team', TEAM, body)).rejects.toMatchObject({ code });
  });

  it('recusa PNG pequeno demais e arquivo grande demais', async () => {
    await expect(prepareCrest('team', TEAM, await png(64))).rejects.toMatchObject({ code: 'too_small' });
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    await expect(prepareCrest('team', TEAM, big)).rejects.toBeInstanceOf(CrestError);
  });
});
