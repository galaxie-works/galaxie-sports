/**
 * Recodifica a imagem anexada antes de gravar (só no servidor): aplica a orientação do EXIF e sai sem nenhum
 * metadado (EXIF, GPS, ICC, XMP; o sharp não copia metadados a menos que peçam). Lado maior limitado a 4096 px.
 * Mantém o formato: PNG continua PNG (prints com texto), JPEG continua JPEG.
 */
import sharp from 'sharp';

import type { FeedbackImageType } from './rules';

export const FEEDBACK_IMAGE_MAX_PX = 4096;
/**
 * Teto de pixels da ENTRADA (largura × altura do cabeçalho, conferido antes de decodificar): um PNG de poucos KB
 * pode declarar 50.000 × 50.000 e estourar a memória do `site`. 24 MP cobre foto de celular (6000 × 4000) e print 4K, e cabe no contêiner `console` (320 MB).
 */
export const FEEDBACK_IMAGE_MAX_INPUT_PIXELS = 24_000_000;

export async function cleanImage(
  body: Uint8Array,
  type: FeedbackImageType,
  maxInputPixels = FEEDBACK_IMAGE_MAX_INPUT_PIXELS,
): Promise<Uint8Array> {
  const img = sharp(body, { failOn: 'error', limitInputPixels: maxInputPixels }).rotate().resize({
    width: FEEDBACK_IMAGE_MAX_PX,
    height: FEEDBACK_IMAGE_MAX_PX,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const out = type === 'image/png' ? await img.png().toBuffer() : await img.jpeg({ quality: 88 }).toBuffer();
  return new Uint8Array(out);
}
