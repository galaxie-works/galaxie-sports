/**
 * Dimensões e tipo de imagens a partir dos primeiros bytes (PNG, GIF, JPEG, WebP, SVG), sem dependências.
 * Os assets da api-sports são quase todos PNG (logos, fotos) e SVG (bandeiras).
 */

export interface ImageInfo {
  contentType: string;
  width: number | null;
  height: number | null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Uint8Array, bytes: number[]): boolean {
  return bytes.every((b, i) => buf[i] === b);
}

function svgDimension(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(value);
  return m ? Math.round(Number(m[1])) : null;
}

function parseSvg(text: string): ImageInfo {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  let width = svgDimension(attr('width'));
  let height = svgDimension(attr('height'));
  const viewBox = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if ((width == null || height == null) && viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    width ??= Math.round(viewBox[2]!);
    height ??= Math.round(viewBox[3]!);
  }
  return { contentType: 'image/svg+xml', width, height };
}

function parseJpeg(buf: Uint8Array): ImageInfo {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1]!;
    // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        contentType: 'image/jpeg',
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return { contentType: 'image/jpeg', width: null, height: null };
}

/** Identifica a imagem pelo conteúdo; `fallbackType` (header Content-Type) vale para o que não for reconhecido. */
export function imageInfo(buf: Uint8Array, fallbackType = 'application/octet-stream'): ImageInfo {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length >= 24 && startsWith(buf, PNG_SIGNATURE)) {
    return { contentType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (buf.length >= 10 && startsWith(buf, [0x47, 0x49, 0x46, 0x38])) {
    return { contentType: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (buf.length >= 4 && startsWith(buf, [0xff, 0xd8, 0xff])) return parseJpeg(buf);
  if (buf.length >= 30 && startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf[8] === 0x57 && buf[9] === 0x45) {
    const chunk = String.fromCharCode(...buf.subarray(12, 16));
    if (chunk === 'VP8X')
      return {
        contentType: 'image/webp',
        width: 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)),
        height: 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)),
      };
    // VP8 (com perdas): quadro-chave começa em 20, com o código 9d 01 2a e 14 bits de largura e altura
    if (chunk === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a)
      return {
        contentType: 'image/webp',
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    // VP8L (sem perdas): assinatura 0x2f e 14 bits (menos 1) de largura e altura
    if (chunk === 'VP8L' && buf[20] === 0x2f) {
      const [b1, b2, b3, b4] = [buf[21]!, buf[22]!, buf[23]!, buf[24]!];
      return {
        contentType: 'image/webp',
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      };
    }
    return { contentType: 'image/webp', width: null, height: null };
  }
  const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 4096)));
  if (/<svg\b/i.test(head)) return parseSvg(new TextDecoder().decode(buf));
  return {
    contentType: fallbackType.split(';')[0]!.trim() || 'application/octet-stream',
    width: null,
    height: null,
  };
}
