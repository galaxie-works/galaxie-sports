import { crc32, deflateSync } from 'node:zlib';

/** Canais por tipo de cor do PNG. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export interface EncodePngOptions {
  width: number;
  height: number;
  colorType: number;
  bitDepth?: number;
  /** Bytes de cada linha já empacotados (sem o byte de filtro). */
  rows: number[][];
  /** Filtro aplicado a todas as linhas ou um por linha (0–4; outro valor é gravado como está). */
  filter?: number | number[];
  palette?: number[];
  trns?: number[];
  interlace?: number;
  /** Substitui o IDAT inteiro (para testar zlib inválido/curto). */
  rawIdat?: Uint8Array;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(Buffer.concat([typeBytes, data])));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** PNG sintético para os testes do decodificador (aplica os filtros de verdade, comprime com zlib). */
export function encodePng(o: EncodePngOptions): Uint8Array {
  const bitDepth = o.bitDepth ?? 8;
  const bpp = Math.max(1, (CHANNELS[o.colorType]! * bitDepth) >> 3);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, o.width);
  view.setUint32(4, o.height);
  ihdr.set([bitDepth, o.colorType, 0, 0, o.interlace ?? 0], 8);

  const filtered: number[] = [];
  o.rows.forEach((row, y) => {
    const filter = Array.isArray(o.filter) ? o.filter[y]! : (o.filter ?? 0);
    const prev = o.rows[y - 1];
    filtered.push(filter);
    row.forEach((value, x) => {
      const a = x >= bpp ? row[x - bpp]! : 0;
      const b = prev ? prev[x]! : 0;
      const c = prev && x >= bpp ? prev[x - bpp]! : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0;
      filtered.push((value - predictor + 256) & 0xff);
    });
  });

  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(o.palette ? [chunk('PLTE', Uint8Array.from(o.palette))] : []),
    ...(o.trns ? [chunk('tRNS', Uint8Array.from(o.trns))] : []),
    chunk('IDAT', o.rawIdat ?? deflateSync(Uint8Array.from(filtered))),
    chunk('IEND', new Uint8Array()),
  ];
  return Uint8Array.from(Buffer.concat(parts));
}

export interface ColorShare {
  color: [number, number, number];
  /** Alfa (padrão 255). */
  alpha?: number;
  /** Fração dos pixels (as frações são arredondadas e preenchidas em sequência). */
  share: number;
}

/** Buffer RGBA com blocos de cor nas proporções pedidas (o resto fica transparente). */
export function solidRgba(width: number, height: number, colors: ColorShare[]): Uint8Array {
  const total = width * height;
  const rgba = new Uint8Array(total * 4);
  let p = 0;
  for (const { color, alpha = 255, share } of colors) {
    const n = Math.round(share * total);
    for (let i = 0; i < n && p < total; i++, p++) rgba.set([...color, alpha], p * 4);
  }
  return rgba;
}
