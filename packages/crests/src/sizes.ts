/**
 * Tamanhos fixos dos logos do acervo: do PNG do pacote (com transparência), PNG e WebP em 64, 128, 256 e
 * 512 px, publicados pela API em `logo_sizes`. O logo é encaixado num quadrado do tamanho pedido sem cortar
 * nem distorcer (sobra transparente). Um PNG que já é um quadrado do tamanho pedido não é refeito: no 512, a
 * API usa o próprio `png`/`webp` de `logo_formats`.
 */
import sharp from 'sharp';
import { ASSET_SIZES, type AssetRasterFormat, type AssetSize } from '@galaxie/db/schema';

export interface SizedLogo {
  size: AssetSize;
  format: AssetRasterFormat;
  contentType: 'image/png' | 'image/webp';
  body: Uint8Array;
}

/**
 * Gera PNG e WebP em cada tamanho fixo até o lado maior do original (não amplia um PNG pequeno). No tamanho
 * igual ao lado maior, só refaz o PNG que não é quadrado (o quadrado já é o arquivo certo).
 */
export async function sizedLogos(png: Uint8Array): Promise<SizedLogo[]> {
  const meta = await sharp(png).metadata();
  const side = Math.max(meta.width ?? 0, meta.height ?? 0);
  const square = meta.width === meta.height;
  const out: SizedLogo[] = [];
  for (const size of ASSET_SIZES) {
    if (size > side || (size === side && square)) continue;
    const resized = sharp(png).resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    });
    const [pngBody, webpBody] = await Promise.all([
      resized.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(),
      resized.clone().webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer(),
    ]);
    out.push({ size, format: 'png', contentType: 'image/png', body: new Uint8Array(pngBody) });
    out.push({ size, format: 'webp', contentType: 'image/webp', body: new Uint8Array(webpBody) });
  }
  return out;
}

/** O 512 de um PNG que já é um quadrado de 512 (o SVG renderizado por `crestPng512`): o próprio PNG e o WebP dele. */
export async function squareLogo512(png: Uint8Array): Promise<SizedLogo[]> {
  const webp = await sharp(png).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
  return [
    { size: 512, format: 'png', contentType: 'image/png', body: png },
    { size: 512, format: 'webp', contentType: 'image/webp', body: new Uint8Array(webp) },
  ];
}
