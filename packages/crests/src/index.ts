export { imageInfo, type ImageInfo } from './image-info.js';
export {
  computePalette,
  decodePng,
  MONOCHROME_DOMINANT,
  PALETTE_VERSION,
  paletteFromPng,
  type AssetPalette,
  type DecodedImage,
} from './palette.js';
export { paletteFromSvg, parseColor } from './svg-palette.js';
export { unsafeSvgReason } from './svg-safety.js';
export { sizedLogos, type SizedLogo } from './sizes.js';
export {
  CREST_MAX_BYTES,
  CREST_MIN_PX,
  CREST_RASTER_PX,
  CrestError,
  crestStorageKey,
  prepareCrest,
  type CrestErrorCode,
  type CrestKind,
  type CrestObject,
  type PreparedCrest,
} from './prepare.js';
