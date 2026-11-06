import type { MediaAssetKind } from '@galaxie/apisports-client';
import { PLACEHOLDER_LOGO_SHA256 } from '@galaxie/core-writer';
import { PLACEHOLDER_PHOTO_SHA256 } from './person-photos.js';

/**
 * Imagens genéricas da CDN de mídia, das duas listas (fotos de pessoa e logos). Estádio, circuito, bandeira,
 * lutador e piloto recebem as mesmas: em 06/11/2026, 5.847 estádios espelhados eram a câmera "image not
 * available" ou o escudo-contorno cinza.
 */
export const PLACEHOLDER_IMAGE_SHA256: ReadonlySet<string> = new Set([
  ...PLACEHOLDER_PHOTO_SHA256,
  ...PLACEHOLDER_LOGO_SHA256,
]);

/**
 * Kinds da CDN de mídia que não são foto de pessoa nem logo (estes têm lista própria: `isPlaceholderPhoto`,
 * `isPlaceholderLogo`).
 */
export const OTHER_IMAGE_KIND_VALUES = [
  'venue',
  'circuit',
  'flag',
  'fighter',
  'driver',
] as const satisfies readonly MediaAssetKind[];
const OTHER_IMAGE_KINDS: ReadonlySet<string> = new Set(OTHER_IMAGE_KIND_VALUES);

export function isOtherImageKind(kind: string): boolean {
  return OTHER_IMAGE_KINDS.has(kind);
}

/** A imagem de estádio, circuito, bandeira, lutador ou piloto é uma das genéricas do fornecedor? */
export function isPlaceholderImage(
  kind: string,
  sha256: string,
  placeholders: ReadonlySet<string> = PLACEHOLDER_IMAGE_SHA256,
): boolean {
  return isOtherImageKind(kind) && placeholders.has(sha256);
}
