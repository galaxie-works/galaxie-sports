/**
 * Cores do time extraídas do escudo (team_logo), sem dependências: um decodificador PNG mínimo
 * (`node:zlib`) e uma quantização simples por matiz/luminosidade. Base do `colors` do Team na API
 * (cor predominante, secundária e o gradiente sugerido) — nenhuma chamada externa.
 */
import { inflateSync } from 'node:zlib';
import type { AssetPalette } from '@galaxie/db';

export type { AssetPalette };

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA 8 bits por canal, linha a linha. */
  rgba: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Teto de pixels decodificados (escudos da api-sports têm ~150×150). */
const MAX_PIXELS = 4096 * 4096;
/** Canais por tipo de cor do PNG. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decodifica um PNG não entrelaçado para RGBA 8 bits. Suporta tipos de cor 0 (cinza), 2 (RGB),
 * 3 (paleta, com tRNS), 4 (cinza + alfa) e 6 (RGBA) em 8 bits, os cinzas/paletas de 1/2/4 bits e os
 * de 16 bits (reduzidos ao byte alto — alguns escudos da api-sports vêm assim). Devolve null para o
 * que não suporta (entrelaçado, não-PNG, SVG) ou para arquivos corrompidos.
 */
export function decodePng(input: Uint8Array): DecodedImage | null {
  if (input.length < 33 || !PNG_SIGNATURE.every((b, i) => input[i] === b)) return null;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let offset = 8;
  while (offset + 8 <= input.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > input.length) return null;
    const data = input.subarray(start, end);
    if (type === 'IHDR') {
      if (length < 13) return null;
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset = end + 4; // + CRC
  }

  const channels = CHANNELS[colorType];
  if (!channels || !width || !height || width * height > MAX_PIXELS || interlace !== 0) return null;
  const lowBitOk = (colorType === 0 || colorType === 3) && [1, 2, 4].includes(bitDepth);
  const wideOk = colorType !== 3 && bitDepth === 16;
  if (bitDepth !== 8 && !lowBitOk && !wideOk) return null;
  if (colorType === 3 && !palette) return null;
  if (!idat.length) return null;

  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }

  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < height * (stride + 1)) return null;

  // desfaz os filtros linha a linha (in place sobre uma cópia sem o byte de filtro)
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x]!;
      const a = x >= bpp ? pixels[dst + x - bpp]! : 0;
      const b = y > 0 ? pixels[prev + x]! : 0;
      const c = x >= bpp && y > 0 ? pixels[prev + x - bpp]! : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + a;
          break;
        case 2:
          out = value + b;
          break;
        case 3:
          out = value + ((a + b) >> 1);
          break;
        case 4:
          out = value + paeth(a, b, c);
          break;
        default:
          return null;
      }
      pixels[dst + x] = out & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  // n-ésima amostra da linha, na profundidade original (1–16 bits)
  const sample = (row: number, index: number): number => {
    const base = row * stride;
    if (bitDepth === 8) return pixels[base + index]!;
    if (bitDepth === 16) return (pixels[base + index * 2]! << 8) | pixels[base + index * 2 + 1]!;
    const bit = index * bitDepth;
    const byte = pixels[base + (bit >> 3)]!;
    const shift = 8 - bitDepth - (bit & 7);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  };
  /** Amostra reduzida a 8 bits (cores e alfa dos tipos 2, 4 e 6). */
  const sample8 = (row: number, index: number): number =>
    bitDepth === 16 ? sample(row, index) >> 8 : sample(row, index);
  const greyScale = 255 / ((1 << bitDepth) - 1);
  const word = (i: number) => (trns![i]! << 8) | trns![i + 1]!;
  const trnsGrey = colorType === 0 && trns && trns.length >= 2 ? word(0) : -1;
  const trnsRgb = colorType === 2 && trns && trns.length >= 6 ? [word(0), word(2), word(4)] : null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      switch (colorType) {
        case 0: {
          const v = sample(y, x);
          const g = Math.round(v * greyScale);
          rgba.set([g, g, g, v === trnsGrey ? 0 : 255], o);
          break;
        }
        case 2: {
          const r = sample(y, i);
          const g = sample(y, i + 1);
          const b = sample(y, i + 2);
          const transparent = trnsRgb && r === trnsRgb[0] && g === trnsRgb[1] && b === trnsRgb[2];
          const shift = bitDepth === 16 ? 8 : 0;
          rgba.set([r >> shift, g >> shift, b >> shift, transparent ? 0 : 255], o);
          break;
        }
        case 3: {
          const idx = sample(y, x);
          if (idx * 3 + 2 >= palette!.length) return null;
          const alpha = trns && idx < trns.length ? trns[idx]! : 255;
          rgba.set([palette![idx * 3]!, palette![idx * 3 + 1]!, palette![idx * 3 + 2]!, alpha], o);
          break;
        }
        case 4: {
          const g = sample8(y, i);
          rgba.set([g, g, g, sample8(y, i + 1)], o);
          break;
        }
        case 6:
          rgba.set([sample8(y, i), sample8(y, i + 1), sample8(y, i + 2), sample8(y, i + 3)], o);
          break;
      }
    }
  }
  return { width, height, rgba };
}

// ─── paleta ──────────────────────────────────────────────────────────────────────────────────────

export const PALETTE_VERSION = 1;
/** Cor usada no gradiente quando o escudo é preto/branco/cinza. */
export const MONOCHROME_DOMINANT = '#3a3a3a';

/**
 * Imagens genéricas que o fornecedor serve no lugar do escudo ("image not available", "official logo
 * soon", escudo-contorno cinza), identificadas pelo sha256 — cada uma aparece em dezenas de times.
 * Não têm cor de time: ficam sem paleta (e o backfill não as lê de novo).
 */
export const PLACEHOLDER_LOGO_SHA256: ReadonlySet<string> = new Set([
  '72f0bbb253ab54961cd5d66148e55aceb3e6bc9823da43e57a6e0812e5427430', // image not available
  '7670cc2d08b0b4a846ac6ec076c99d3767c4d2b9322e2d31cd05871422ddbbda', // image not available
  '78e6132b4b2566fbab177137480d0f883aee9c2370bd9a668787263c1a2d9138', // official logo soon
  'b602abdd01273f6dd29855a6aed585747243148768da4a5a54e3cebd9989fd36', // escudo-contorno cinza
  'a2cea5dc38d2802f6f45317809cba250357b375cd3ba0373754fa9b4938f453b', // escudo-contorno cinza
]);

/** Pixels com alfa abaixo disso são borda/fundo e não contam. */
const MIN_ALPHA = 200;
/** Croma (max − min, 0–255) abaixo disso é cinza. */
const MIN_CHROMA = 40;
/** Luminosidade HSL fora de [MIN_L, MAX_L] é quase preto/quase branco. */
const MIN_L = 0.08;
const MAX_L = 0.92;
/** Menos que isso de pixels saturados (sobre os opacos) → escudo monocromático. */
const MONOCHROME_RATIO = 0.08;
/** Largura das faixas de matiz (graus). */
const HUE_STEP = 15;
/** Distância mínima de matiz entre predominante e secundária (graus). */
const SECONDARY_MIN_HUE = 40;
/** A secundária precisa ter ao menos esta fração dos pixels saturados. */
const SECONDARY_MIN_SHARE = 0.06;
/** Faixas de luminosidade dentro de uma família de matiz. */
const L_BANDS = [0.3, 0.5, 0.7];

interface Bucket {
  hue: number;
  count: number;
  /** soma RGB por faixa de luminosidade */
  bands: { count: number; r: number; g: number; b: number }[];
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Cor de uma família de matiz (a faixa e as vizinhas): média da faixa de luminosidade mais frequente
 * — evita misturar verde-escuro com verde-claro num tom intermediário que não está no escudo.
 */
function familyColor(family: Bucket[]): string {
  const bands = family[0]!.bands.map((_, i) =>
    family.reduce(
      (acc, bucket) => {
        const b = bucket.bands[i]!;
        return { count: acc.count + b.count, r: acc.r + b.r, g: acc.g + b.g, b: acc.b + b.b };
      },
      { count: 0, r: 0, g: 0, b: 0 },
    ),
  );
  const band = bands.reduce((best, b) => (b.count > best.count ? b : best));
  return hex(band.r / band.count, band.g / band.count, band.b / band.count);
}

/**
 * Cor predominante e secundária de um escudo RGBA. Considera só pixels opacos (alfa ≥ 200); ignora
 * quase-branco, quase-preto e cinzas na escolha; agrupa por faixas de matiz de 15° (suavizadas com as
 * vizinhas) e, dentro da família vencedora, tira a média da faixa de luminosidade mais frequente.
 * A secundária é a próxima família com matiz a ≥ 40° da predominante e ao menos 6% dos pixels
 * saturados. Escudos sem cor (preto/branco) saem `monochrome` com um cinza-escuro neutro, para o
 * gradiente continuar legível. Null quando a imagem não tem pixels opacos.
 */
export function computePalette(rgba: Uint8Array, width: number, height: number): AssetPalette | null {
  const total = Math.min(width * height, Math.floor(rgba.length / 4));
  const nBuckets = 360 / HUE_STEP;
  const buckets: Bucket[] = Array.from({ length: nBuckets }, (_, i) => ({
    hue: i * HUE_STEP + HUE_STEP / 2,
    count: 0,
    bands: Array.from({ length: L_BANDS.length + 1 }, () => ({ count: 0, r: 0, g: 0, b: 0 })),
  }));

  let opaque = 0;
  let colored = 0;
  for (let p = 0; p < total; p++) {
    const o = p * 4;
    if (rgba[o + 3]! < MIN_ALPHA) continue;
    opaque += 1;
    const r = rgba[o]!;
    const g = rgba[o + 1]!;
    const b = rgba[o + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const l = (max + min) / 510;
    if (chroma < MIN_CHROMA || l < MIN_L || l > MAX_L) continue;
    colored += 1;
    let h: number;
    if (max === r) h = ((g - b) / chroma) % 6;
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
    h = (h * 60 + 360) % 360;
    const bucket = buckets[Math.floor(h / HUE_STEP) % nBuckets]!;
    bucket.count += 1;
    const bandIndex = L_BANDS.findIndex((t) => l < t);
    const band = bucket.bands[bandIndex === -1 ? L_BANDS.length : bandIndex]!;
    band.count += 1;
    band.r += r;
    band.g += g;
    band.b += b;
  }

  if (!opaque) return null;
  if (colored / opaque < MONOCHROME_RATIO) {
    return { version: PALETTE_VERSION, dominant: MONOCHROME_DOMINANT, secondary: null, monochrome: true };
  }

  // pontuação suavizada (faixa + metade das vizinhas): matizes na fronteira entre faixas não se dividem
  const score = (i: number) =>
    buckets[i]!.count +
    0.5 * (buckets[(i + nBuckets - 1) % nBuckets]!.count + buckets[(i + 1) % nBuckets]!.count);
  const family = (i: number) => [
    buckets[(i + nBuckets - 1) % nBuckets]!,
    buckets[i]!,
    buckets[(i + 1) % nBuckets]!,
  ];
  const ranked = buckets
    .map((bucket, i) => ({ i, bucket, score: score(i) }))
    .filter((x) => x.bucket.count > 0)
    .sort((a, b) => b.score - a.score || b.bucket.count - a.bucket.count);

  const top = ranked[0]!;
  const second = ranked.find(
    (x) =>
      hueDistance(x.bucket.hue, top.bucket.hue) >= SECONDARY_MIN_HUE &&
      x.bucket.count >= colored * SECONDARY_MIN_SHARE,
  );

  return {
    version: PALETTE_VERSION,
    dominant: familyColor(family(top.i)),
    // a secundária usa só a própria faixa: as vizinhas podem invadir a família da predominante
    secondary: second ? familyColor([second.bucket]) : null,
    monochrome: false,
  };
}

/** Atalho do espelho/backfill: PNG → paleta (null se não for PNG decodificável ou não tiver pixels opacos). */
export function paletteFromPng(body: Uint8Array): AssetPalette | null {
  const image = decodePng(body);
  return image && computePalette(image.rgba, image.width, image.height);
}
