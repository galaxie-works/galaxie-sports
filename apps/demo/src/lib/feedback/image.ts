/**
 * Recodifica a imagem anexada antes de gravar (só no servidor): aplica a orientação do EXIF e sai sem nenhum
 * metadado (EXIF, GPS, ICC, XMP; o sharp não copia metadados a menos que peçam). Lado maior limitado a 4096 px.
 * Mantém o formato: PNG continua PNG (prints com texto), JPEG continua JPEG.
 */
import sharp from 'sharp';

import type { FeedbackImageType } from './rules';

export const FEEDBACK_IMAGE_MAX_PX = 4096;

export async function cleanImage(body: Uint8Array, type: FeedbackImageType): Promise<Uint8Array> {
  const img = sharp(body, { failOn: 'error' }).rotate().resize({
    width: FEEDBACK_IMAGE_MAX_PX,
    height: FEEDBACK_IMAGE_MAX_PX,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const out = type === 'image/png' ? await img.png().toBuffer() : await img.jpeg({ quality: 88 }).toBuffer();
  return new Uint8Array(out);
}
