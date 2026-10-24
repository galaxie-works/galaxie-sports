import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { highlightPhoto } from './import.js';
import { readManifest, type ManifestEntry, type ManifestPhoto } from './manifest.js';

const photo = (file: string, o: Partial<ManifestPhoto> = {}) =>
  ({ file, match: 'auto', share_alike: false, ...o }) as ManifestPhoto;
const car = (photos: ManifestPhoto[]) => ({ target: 'car/mclaren/1991', photos }) as ManifestEntry;

describe('foto do carro de destaque (fundo do heading do piloto)', () => {
  it('a primeira não rejeitada e sem CC BY-SA', () => {
    expect(
      highlightPhoto(
        car([
          photo('File:rejeitada.jpg', { match: 'rejected' }),
          photo('File:by-sa.jpg', { share_alike: true }),
          photo('File:by.jpg'),
        ]),
      )?.file,
    ).toBe('File:by.jpg');
  });

  it('só BY-SA: sem destaque (o heading usa a cor da equipe)', () => {
    expect(highlightPhoto(car([photo('File:by-sa.jpg', { share_alike: true })]))).toBeUndefined();
    expect(highlightPhoto(undefined)).toBeUndefined();
  });

  describe('manifesto', () => {
    const manifest = readManifest(
      fileURLToPath(new URL('../../../../../config/assets/commons/f1.yaml', import.meta.url)),
    )!;
    const byTarget = new Map(manifest.entries.map((e) => [e.target, e]));

    it('curadoria do carro de destaque recusa carro sem foto compatível (BY-SA no fundo não entra)', () => {
      const curated = manifest.entries.filter((e) => e.highlight_car?.match === 'manual');
      expect(curated.length).toBeGreaterThan(0);
      for (const e of curated) {
        const target = byTarget.get(e.highlight_car!.target);
        expect(target, `${e.target} → ${e.highlight_car!.target}`).toBeDefined();
        const chosen = highlightPhoto(target);
        expect(
          chosen,
          `${e.target}: ${e.highlight_car!.target} só tem foto CC BY-SA ou rejeitada`,
        ).toBeDefined();
        expect(chosen!.share_alike).toBe(false);
        expect(chosen!.license).not.toMatch(/BY-SA/i);
      }
    });

    it('Senna: Phoenix 1991, com o #1 de campeão', () => {
      const senna = byTarget.get('driver/ayrton-senna')!;
      expect(senna.highlight_car).toMatchObject({
        target: 'car/mclaren/1991',
        season: 1991,
        match: 'manual',
      });
      expect(highlightPhoto(byTarget.get('car/mclaren/1991'))?.file).toBe(
        'File:Ayrton Senna 1991 USA 3 cropped.jpg',
      );
    });
  });
});
