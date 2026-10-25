import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { highlightPhoto, pickHighlight } from './import.js';
import { readManifest, type HighlightCar, type ManifestEntry, type ManifestPhoto } from './manifest.js';

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

  describe('candidatos em ordem (pickHighlight)', () => {
    const entry = (target: string, photos: ManifestPhoto[], o: Partial<ManifestEntry> = {}) =>
      ({ target, kind: target.split('/')[0], photos, ...o }) as ManifestEntry;
    const cars = [
      entry('car/mercedes/2020', [photo('File:W11 by-sa.jpg', { share_alike: true })]),
      entry('car/mercedes/2019', []),
      entry('car/ferrari/2026', [
        photo('File:SF-26 Leclerc.jpg', { hero: 0.8 }),
        photo('File:SF-26 by-sa.jpg', { share_alike: true, hero: 0.9 }),
      ]),
    ];
    const byTarget = new Map(cars.map((c) => [c.target, c]));
    const lewis = (highlight_car: HighlightCar, photos: ManifestPhoto[] = []) =>
      entry('driver/lewis-hamilton', photos, { highlight_car });
    const auto = {
      target: 'car/mercedes/2020',
      season: 2020,
      reason: 'título de 2020',
      match: 'auto' as const,
      fallbacks: [
        { target: 'car/mercedes/2019', season: 2019, reason: 'título de 2019' },
        { target: 'car/ferrari/2026', season: 2026, reason: 'temporada atual: 2026' },
      ],
    };

    it('carro do título só com BY-SA (ou sem foto): fica o próximo candidato com foto para o fundo', () => {
      expect(pickHighlight(lewis(auto), byTarget)).toMatchObject({
        target: 'car/ferrari/2026',
        season: 2026,
        photo: { file: 'File:SF-26 Leclerc.jpg' },
      });
    });

    it('carro sem a nota do Gemini não vai ao fundo (cor da equipe), nem a primeira foto compatível', () => {
      const semNota = new Map(byTarget);
      semNota.set('car/ferrari/2026', entry('car/ferrari/2026', [photo('File:SF-26 Leclerc.jpg')]));
      expect(pickHighlight(lewis(auto), semNota)).toBeUndefined();
      // o carro da curadoria vale sem a nota
      const manual = { ...auto, target: 'car/ferrari/2026', season: 2026, match: 'manual' as const };
      expect(pickHighlight(lewis(manual), semNota)?.photo.file).toBe('File:SF-26 Leclerc.jpg');
    });

    it('nenhum candidato com foto compatível: sem destaque', () => {
      expect(
        pickHighlight(lewis({ ...auto, fallbacks: auto.fallbacks.slice(0, 1) }), byTarget),
      ).toBeUndefined();
    });

    it('curadoria fica no carro escolhido (sem candidatos) e pode apontar a foto, até da galeria do piloto', () => {
      const manual = {
        target: 'car/mercedes/2020',
        season: 2020,
        reason: 'curadoria',
        match: 'manual' as const,
      };
      expect(pickHighlight(lewis({ ...manual, fallbacks: auto.fallbacks }), byTarget)).toBeUndefined();
      const own = photo('File:2026 Chinese GP - Ferrari - Lewis Hamilton - Qualifying.jpg', {
        role: 'action',
      });
      const curated = {
        target: 'car/ferrari/2026',
        season: 2026,
        reason: 'pedido do produto: equipe atual',
        match: 'manual' as const,
        file: own.file,
      };
      expect(pickHighlight(lewis(curated, [own]), byTarget)).toMatchObject({
        target: 'car/ferrari/2026',
        season: 2026,
        photo: { file: own.file },
      });
      // a foto apontada nunca é BY-SA
      expect(pickHighlight(lewis({ ...curated, file: 'File:SF-26 by-sa.jpg' }), byTarget)).toBeUndefined();
    });
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
        // a foto que a importação leva ao fundo (a de `file`, quando a curadoria aponta uma)
        const chosen = pickHighlight(e, byTarget)?.photo;
        expect(
          chosen,
          `${e.target}: ${e.highlight_car!.target} só tem foto CC BY-SA ou rejeitada`,
        ).toBeDefined();
        if (e.highlight_car!.file) expect(chosen!.file).toBe(e.highlight_car!.file);
        expect(chosen!.share_alike).toBe(false);
        expect(chosen!.license).not.toMatch(/BY-SA/i);
      }
    });

    it('pedidos do produto: Hamilton na Ferrari 2026, Fangio em Zandvoort 1955, Farina em Monza 1950', () => {
      const fundo = (driver: string) => {
        const p = pickHighlight(byTarget.get(driver)!, byTarget);
        return [p?.target, p?.season, p?.photo.file, p?.photo.license];
      };
      expect(fundo('driver/lewis-hamilton')).toEqual([
        'car/ferrari/2026',
        2026,
        'File:2026 Chinese GP - Ferrari - Lewis Hamilton - Qualifying.jpg',
        'CC BY 4.0',
      ]);
      expect(fundo('driver/juan-manuel-fangio')).toEqual([
        'car/mercedes/1955',
        1955,
        'File:Grote Prijs van Nederland Zandvoort. Vooraan J. M. Fangio in Mercedes (de latere, Bestanddeelnr 907-1903.jpg',
        'CC0',
      ]);
      expect(fundo('driver/nino-farina')).toEqual([
        'car/alfa-romeo/1950',
        1950,
        'File:1950 Italian Grand Prix - Farina (Alfa Romeo) ahead Ascari (Ferrari) at Porfido bends.jpg',
        'Public domain',
      ]);
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
