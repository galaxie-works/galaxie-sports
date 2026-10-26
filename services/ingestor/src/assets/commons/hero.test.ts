import { MemoryTokenBudgetStore, TokenBudget } from '@galaxie/ai-ledger';
import { describe, expect, it } from 'vitest';
import type { CommonsFile } from './client.js';
import type { Discovery } from './discover.js';
import { rankPrompt, rankWithGemini } from './gemini.js';
import { HERO_MIN, highlightPhoto } from './import.js';
import type { CommonsManifest, ManifestEntry, ManifestPhoto } from './manifest.js';
import { pranchaHtml, pranchaRows } from './prancha.js';
import type { CarTarget } from './scope.js';
import { choose, eligible } from './select.js';

/** Nota do Gemini para o fundo do heading (`hero`): Farina 1950, com um close moderno que já foi o fundo. */
const photo = (file: string, o: Partial<ManifestPhoto> = {}) =>
  ({ file, match: 'auto', share_alike: false, ...o }) as ManifestPhoto;
const car = (photos: ManifestPhoto[]) => ({ target: 'car/alfa-romeo/1950', photos }) as ManifestEntry;

describe('fundo do heading pela nota do Gemini', () => {
  it('a de maior nota a partir do corte; close de gente e detalhe ficam de fora', () => {
    const picked = highlightPhoto(
      car([
        photo('File:Close no cockpit.jpg', { hero: 0.1 }),
        photo('File:158 no museu.jpg', { hero: 0.5 }),
        photo('File:Monza 1950 Farina à frente do Ascari.jpg', { hero: 0.95 }),
      ]),
    );
    expect(picked?.file).toBe('File:Monza 1950 Farina à frente do Ascari.jpg');
  });

  it('nenhuma acima do corte: sem fundo neste carro (vale o próximo candidato)', () => {
    expect(HERO_MIN).toBe(0.5);
    expect(
      highlightPhoto(car([photo('File:Close.jpg', { hero: 0.1 }), photo('File:Roda.jpg', { hero: 0.2 })])),
    ).toBeUndefined();
  });

  it('curadoria manual vence a nota; sem nota (só regras), a primeira compatível', () => {
    const manual = photo('File:Escolha do produto.jpg', { match: 'manual', hero: 0.3 });
    expect(highlightPhoto(car([photo('File:A.jpg', { hero: 0.9 }), manual]))?.file).toBe(manual.file);
    expect(highlightPhoto(car([photo('File:A.jpg'), photo('File:B.jpg')]))?.file).toBe('File:A.jpg');
  });
});

describe('Gemini: nota para o fundo', () => {
  it('o prompt do carro pede a nota com a ordem de preferência e as recusas; o do piloto não', () => {
    const p = rankPrompt('Alfa Romeo 158 (1950)', 'car', 3);
    expect(p).toMatch(/hero \(0 a 1\)/);
    expect(p).toMatch(/corrida da própria temporada/);
    expect(p).toMatch(/close de pessoas/);
    expect(rankPrompt('Nino Farina', 'driver', 3)).not.toMatch(/hero/);
  });

  it('a nota vem entre 0 e 1, com duas casas, só no carro', async () => {
    const reply = [
      { index: 0, kind: 'car', keep: true, quality: 7, hero: 1.4 },
      { index: 1, kind: 'car', keep: true, quality: 9, hero: 0.123 },
    ];
    const fetch = (async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }),
      )) as unknown as typeof globalThis.fetch;
    const img = { body: new Uint8Array([1]), mime: 'image/jpeg', title: 'x' };
    const budget = new TokenBudget(new MemoryTokenBudgetStore(), { dailyLimit: null });
    const car = await rankWithGemini([img, img], 'Alfa Romeo 158', 'car', { apiKey: 'k', fetch, budget });
    expect(car.map((j) => j.hero)).toEqual([1, 0.12]);
    const driver = await rankWithGemini([img, img], 'Nino Farina', 'driver', { apiKey: 'k', fetch, budget });
    expect(driver.every((j) => j.hero === undefined)).toBe(true);
  });
});

describe('escolha do carro guarda a melhor para o fundo', () => {
  const file = (title: string): CommonsFile => ({
    title,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    url: 'https://upload.wikimedia.org/x.jpg',
    thumbUrl: 'https://upload.wikimedia.org/thumb/x.jpg',
    thumbWidth: 512,
    thumbHeight: 384,
    width: 1600,
    height: 1200,
    mime: 'image/jpeg',
    extmetadata: {
      License: { value: 'pd' },
      LicenseShortName: { value: 'Public domain' },
      DateTimeOriginal: { value: '1950-09-03' },
    },
    categories: [],
  });
  const target: CarTarget = {
    kind: 'car',
    f1dbId: 'alfa-romeo',
    constructorName: 'Alfa Romeo',
    year: 1950,
    chassis: ['Alfa Romeo 158'],
  };
  const titles = ['Museu A', 'Museu B', 'Museu C', 'Museu D', 'Monza 1950'].map((t) => `File:${t}.jpg`);
  const d: Discovery = {
    target,
    wikidata: null,
    category: 'Alfa Romeo 158',
    note: null,
    candidates: titles.map((t) => ({
      file: file(t),
      season: null,
      wikidataImage: false,
      portraitCategory: false,
    })),
  };

  it('a foto de corrida de 1950 perde em qualidade para as do museu, mas entra pela nota do fundo', () => {
    const { ok } = eligible(d);
    const chosen = choose(d, ok, [
      { index: 0, kind: 'car', keep: true, quality: 9, hero: 0.5 },
      { index: 1, kind: 'car', keep: true, quality: 9, hero: 0.4 },
      { index: 2, kind: 'car', keep: true, quality: 8, hero: 0.4 },
      { index: 3, kind: 'car', keep: true, quality: 8, hero: 0.1 },
      { index: 4, kind: 'car', keep: true, quality: 4, hero: 0.95 },
    ]);
    expect(chosen.map((c) => [c.eligible.candidate.file.title, c.hero])).toEqual([
      ['File:Museu A.jpg', 0.5],
      ['File:Museu B.jpg', 0.4],
      ['File:Museu C.jpg', 0.4],
      ['File:Monza 1950.jpg', 0.95],
    ]);
  });

  it('a foto a mais é a de maior nota entre as que podem ir ao fundo (sem CC BY-SA)', () => {
    const bySa = {
      License: { value: 'cc-by-sa-4.0' },
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      Artist: { value: 'A' },
    };
    const ccBy = {
      License: { value: 'cc-by-4.0' },
      LicenseShortName: { value: 'CC BY 4.0' },
      Artist: { value: 'B' },
    };
    const titles2 = ['SA 1', 'SA 2', 'SA 3', 'SA 4', 'China CC BY'].map((t) => `File:${t}.jpg`);
    const d2: Discovery = {
      ...d,
      candidates: titles2.map((t) => ({
        file: { ...file(t), extmetadata: t.includes('CC BY') ? ccBy : bySa },
        season: 2026,
        wikidataImage: false,
        portraitCategory: false,
      })),
    };
    const chosen = choose(d2, eligible(d2).ok, [
      { index: 0, kind: 'car', keep: true, quality: 9, hero: 0.9 },
      { index: 1, kind: 'car', keep: true, quality: 9, hero: 0.85 },
      { index: 2, kind: 'car', keep: true, quality: 9, hero: 0.8 },
      { index: 3, kind: 'car', keep: true, quality: 8, hero: 0.95 },
      { index: 4, kind: 'car', keep: true, quality: 6, hero: 0.7 },
    ]);
    expect(chosen.map((c) => c.eligible.candidate.file.title)).toEqual([
      'File:SA 1.jpg',
      'File:SA 2.jpg',
      'File:SA 3.jpg',
      'File:China CC BY.jpg',
    ]);
  });
});

describe('prancha do fundo do heading', () => {
  const driver = (target: string, name: string, highlight: string) =>
    ({
      target,
      kind: 'driver',
      name,
      photos: [],
      highlight_car: { target: highlight, season: 1950, reason: 'título', match: 'auto' },
    }) as unknown as ManifestEntry;
  const manifest = (photos: ManifestPhoto[]) =>
    ({
      entries: [
        driver('driver/nino-farina', 'Nino Farina', 'car/alfa-romeo/1950'),
        driver('driver/sem-foto', 'Sem Foto', 'car/nada/1950'),
        car(photos),
      ],
    }) as unknown as CommonsManifest;

  it('o fundo de cada piloto, com as trocas e os sem fundo primeiro', () => {
    const before = manifest([photo('File:Close no cockpit.jpg', { hero: 0.6 })]);
    const after = manifest([
      photo('File:Close no cockpit.jpg', { hero: 0.1 }),
      photo('File:Monza 1950.jpg', { hero: 0.95, license: 'Public domain' }),
    ]);
    const rows = pranchaRows(after, before);
    expect(rows.map((r) => [r.target, r.file, r.before, r.changed])).toEqual([
      ['driver/nino-farina', 'File:Monza 1950.jpg', 'File:Close no cockpit.jpg', true],
      ['driver/sem-foto', null, null, false],
    ]);
    const html = pranchaHtml(rows, 'Prancha');
    expect(html).toContain('Special:FilePath/Monza%201950.jpg?width=480');
    expect(html).toContain('1 trocados pela regra nova');
    expect(html).toContain('antes: Close no cockpit.jpg');
    // carro com foto compatível, mas sem a nota do Gemini: "aguardando nota"
    const semNota = manifest([photo('File:Monza 1950.jpg', { license: 'Public domain' })]);
    expect(pranchaRows(semNota).map((r) => [r.target, r.file, r.pending])).toEqual([
      ['driver/nino-farina', null, true],
      ['driver/sem-foto', null, false],
    ]);
    expect(pranchaHtml(pranchaRows(semNota), 'Prancha')).toContain('aguardando nota do Gemini');
  });
});
