/**
 * Tamanhos fixos dos logos do acervo: do PNG do pacote (512 px, com transparência), PNG e WebP em 64, 128
 * e 256 px, publicados pela API em `logo_sizes` (o 512 é o próprio `png`/`webp` de `logo_formats`). O
 * logo é encaixado num quadrado do tamanho pedido sem cortar nem distorcer (sobra transparente).
 */
import sharp from 'sharp';
import { ASSET_SIZES, type AssetRasterFormat, type AssetSize } from '@galaxie/db';

export interface SizedLogo {
  size: AssetSize;
  format: AssetRasterFormat;
  contentType: 'image/png' | 'image/webp';
  body: Uint8Array;
}

/** Gera PNG e WebP em cada tamanho fixo menor que o original (não amplia um PNG pequeno). */
export async function sizedLogos(png: Uint8Array): Promise<SizedLogo[]> {
  const meta = await sharp(png).metadata();
  const side = Math.max(meta.width ?? 0, meta.height ?? 0);
  const out: SizedLogo[] = [];
  for (const size of ASSET_SIZES) {
    if (size >= side) continue;
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
