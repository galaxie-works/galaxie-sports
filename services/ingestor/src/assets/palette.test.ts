import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng, solidRgba } from '../../test/png.js';
import { computePalette, decodePng, MONOCHROME_DOMINANT, paletteFromPng } from './palette.js';

const RGBA_2x2 = [
  [255, 0, 0, 255, 0, 255, 0, 128],
  [0, 0, 255, 0, 10, 20, 30, 255],
];

describe('decodePng', () => {
  it.each([0, 1, 2, 3, 4])('RGBA 8 bits com o filtro %i', (filter) => {
    const png = encodePng({ width: 2, height: 2, colorType: 6, rows: RGBA_2x2, filter });
    expect(decodePng(png)).toEqual({ width: 2, height: 2, rgba: Uint8Array.from(RGBA_2x2.flat()) });
  });

  it('filtros diferentes por linha numa imagem maior (Paeth/Average com vizinhos reais)', () => {
    const width = 7;
    const rows = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: width * 3 }, (_, x) => (x * 37 + y * 91) % 256),
    );
    const png = encodePng({ width, height: 5, colorType: 2, rows, filter: [4, 3, 1, 2, 0] });
    const out = decodePng(png)!;
    const expected = rows.flatMap((r) =>
      Array.from({ length: width }, (_, x) => [r[x * 3]!, r[x * 3 + 1]!, r[x * 3 + 2]!, 255]).flat(),
    );
    expect([...out.rgba]).toEqual(expected);
  });

  it('RGB com tRNS: a cor marcada vira transparente', () => {
    const png = encodePng({
      width: 2,
      height: 1,
      colorType: 2,
      rows: [[1, 2, 3, 9, 9, 9]],
      trns: [0, 9, 0, 9, 0, 9],
    });
    expect([...decodePng(png)!.rgba]).toEqual([1, 2, 3, 255, 9, 9, 9, 0]);
  });

  it('paleta (tipo 3) em 8 bits com tRNS parcial', () => {
    const png = encodePng({
      width: 3,
      height: 1,
      colorType: 3,
      rows: [[0, 1, 2]],
      palette: [0, 105, 55, 255, 255, 255, 1, 2, 3],
      trns: [255, 100],
    });
    expect([...decodePng(png)!.rgba]).toEqual([0, 105, 55, 255, 255, 255, 255, 100, 1, 2, 3, 255]);
  });

  it('paleta em 4 bits e cinza em 1 bit (amostras empacotadas)', () => {
    const pal = encodePng({
      width: 3,
      height: 1,
      colorType: 3,
      bitDepth: 4,
      rows: [[0x10, 0x20]], // índices 1, 0, 2
      palette: [10, 10, 10, 20, 20, 20, 30, 30, 30],
    });
    expect([...decodePng(pal)!.rgba]).toEqual([20, 20, 20, 255, 10, 10, 10, 255, 30, 30, 30, 255]);

    const grey = encodePng({
      width: 10,
      height: 1,
      colorType: 0,
      bitDepth: 1,
      rows: [[0b10100000, 0b01000000]],
    });
    const values = [...decodePng(grey)!.rgba].filter((_, i) => i % 4 === 0);
    expect(values).toEqual([255, 0, 255, 0, 0, 0, 0, 0, 0, 255]);
  });

  it('cinza 8 bits (com tRNS) e cinza + alfa', () => {
    const grey = encodePng({ width: 2, height: 1, colorType: 0, rows: [[7, 200]], trns: [0, 7] });
    expect([...decodePng(grey)!.rgba]).toEqual([7, 7, 7, 0, 200, 200, 200, 255]);
    const ga = encodePng({ width: 1, height: 1, colorType: 4, rows: [[80, 210]] });
    expect([...decodePng(ga)!.rgba]).toEqual([80, 80, 80, 210]);
  });

  it('16 bits: reduz ao byte alto', () => {
    const png = encodePng({
      width: 1,
      height: 1,
      colorType: 6,
      bitDepth: 16,
      rows: [[0x12, 0x34, 0xab, 0xcd, 0x00, 0xff, 0xff, 0x00]],
    });
    expect([...decodePng(png)!.rgba]).toEqual([0x12, 0xab, 0x00, 0xff]);
  });

  it('devolve null para o que não suporta ou está corrompido', () => {
    const ok = { width: 1, height: 1, colorType: 6, rows: [[1, 2, 3, 255]] };
    expect(decodePng(encodePng({ ...ok, interlace: 1 }))).toBeNull();
    expect(decodePng(encodePng({ ...ok, colorType: 3, rows: [[0]] }))).toBeNull(); // paleta sem PLTE
    expect(decodePng(encodePng({ ...ok, filter: 7 }))).toBeNull();
    expect(decodePng(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    const png = encodePng(ok);
    expect(decodePng(png.subarray(0, 40))).toBeNull();
    // IDAT com lixo no lugar do zlib
    const broken = encodePng({ ...ok, rawIdat: Uint8Array.from([1, 2, 3, 4]) });
    expect(decodePng(broken)).toBeNull();
    // dados curtos demais para as linhas declaradas
    const short = encodePng({ ...ok, rawIdat: deflateSync(Uint8Array.from([0, 1])) });
    expect(decodePng(short)).toBeNull();
  });

  it('não infla além do que o cabeçalho declara (IDAT hostil)', () => {
    // 1×1 RGBA declara 5 bytes descomprimidos; o IDAT descomprime em 64 MiB de zeros
    const bomb = encodePng({
      width: 1,
      height: 1,
      colorType: 6,
      rows: [[0, 0, 0, 0]],
      rawIdat: deflateSync(new Uint8Array(64 * 1024 * 1024)),
    });
    expect(decodePng(bomb)).toBeNull();
  });
});

describe('computePalette', () => {
  const GREEN: [number, number, number] = [0, 105, 55];
  const WHITE: [number, number, number] = [255, 255, 255];

  it('escudo verde e branco com fundo transparente → verde-escuro, sem secundária', () => {
    const img = solidRgba(20, 20, [
      { color: GREEN, share: 0.45 },
      { color: WHITE, share: 0.25 },
      { color: [0, 0, 0], alpha: 0, share: 0.3 },
    ]);
    expect(computePalette(img, 20, 20)).toEqual({
      version: 1,
      dominant: '#006937',
      secondary: null,
      monochrome: false,
    });
  });

  it('azul e amarelo → as duas cores, a mais frequente como predominante', () => {
    const img = solidRgba(10, 10, [
      { color: [3, 69, 138], share: 0.6 },
      { color: [239, 172, 7], share: 0.3 },
      { color: WHITE, share: 0.1 },
    ]);
    expect(computePalette(img, 10, 10)).toMatchObject({ dominant: '#03458a', secondary: '#efac07' });
  });

  it('preto, branco e cinza → monocromático com o cinza neutro', () => {
    const img = solidRgba(10, 10, [
      { color: [0, 0, 0], share: 0.5 },
      { color: WHITE, share: 0.3 },
      { color: [128, 130, 129], share: 0.15 },
      { color: [200, 0, 0], share: 0.05 }, // um detalhe vermelho pequeno não tira o monocromático
    ]);
    expect(computePalette(img, 10, 10)).toEqual({
      version: 1,
      dominant: MONOCHROME_DOMINANT,
      secondary: null,
      monochrome: true,
    });
  });

  it('ignora pixels semitransparentes (borda antisserrilhada) e devolve null sem opacos', () => {
    const edge = solidRgba(4, 4, [{ color: [255, 0, 0], alpha: 199, share: 1 }]);
    expect(computePalette(edge, 4, 4)).toBeNull();
    const mixed = solidRgba(10, 10, [
      { color: [255, 0, 0], alpha: 150, share: 0.7 },
      { color: GREEN, share: 0.3 },
    ]);
    expect(computePalette(mixed, 10, 10)?.dominant).toBe('#006937');
  });

  it('secundária precisa de matiz distinto (≥ 40°) e presença mínima', () => {
    // vermelho + laranja-avermelhado (perto demais) + azul com 3% (pouco demais)
    const img = solidRgba(10, 10, [
      { color: [200, 16, 46], share: 0.6 },
      { color: [220, 60, 20], share: 0.37 },
      { color: [0, 0, 200], share: 0.03 },
    ]);
    expect(computePalette(img, 10, 10)).toMatchObject({ secondary: null, monochrome: false });
  });

  it('dentro da família vencedora, usa a faixa de luminosidade mais frequente (não a média de tons)', () => {
    const img = solidRgba(10, 10, [
      { color: [0, 105, 55], share: 0.5 }, // verde-escuro
      { color: [120, 220, 160], share: 0.3 }, // verde-claro
      { color: WHITE, share: 0.2 },
    ]);
    expect(computePalette(img, 10, 10)?.dominant).toBe('#006937');
  });

  it('matiz na fronteira entre faixas não se divide (vizinhas somam)', () => {
    // dois tons de azul em faixas vizinhas (~206° e ~217°) somam mais que o vermelho isolado
    const img = solidRgba(10, 10, [
      { color: [20, 110, 180], share: 0.3 },
      { color: [20, 90, 200], share: 0.3 },
      { color: [200, 20, 20], share: 0.4 },
    ]);
    const palette = computePalette(img, 10, 10)!;
    expect(palette).toMatchObject({ dominant: '#1464be', secondary: '#c81414' });
  });
});

describe('paletteFromPng', () => {
  it('PNG de escudo → paleta; não-PNG → null', () => {
    const rows = [
      [0, 105, 55, 255, 255, 255, 255, 255],
      [0, 105, 55, 255, 0, 0, 0, 0],
    ];
    expect(paletteFromPng(encodePng({ width: 2, height: 2, colorType: 6, rows }))).toMatchObject({
      dominant: '#006937',
      monochrome: false,
    });
    expect(paletteFromPng(new TextEncoder().encode('<svg/>'))).toBeNull();
  });
});
