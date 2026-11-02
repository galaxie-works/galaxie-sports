/**
 * Preparo de um escudo enviado no painel (Ajustes → Escudos), pelas mesmas regras da importação do acervo
 * (`assets:acervo`), para um time ou uma competição de cada vez:
 *
 * 1. confere o arquivo pelo conteúdo: SVG, PNG ou WebP, até 5 MB; SVG com conteúdo ativo é recusado
 *    (`unsafeSvgReason`), como no pacote;
 * 2. monta o PNG e o WebP de 512 px (do SVG, renderizado; do PNG/WebP, encaixado sem cortar), os tamanhos
 *    fixos 64/128/256 em PNG e WebP (`sizedLogos`) e a paleta (cores do time);
 * 3. dá a cada arquivo a chave do storage no padrão do acervo (`crestStorageKey`: tipo, id do nosso time
 *    ou competição e o começo do sha256), sem nome de arquivo nem de marca.
 *
 * Não grava nada: quem chama sobe `objects` no storage e registra `asset` no banco (`setPanelCrest`).
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AssetFormat, AssetPalette, AssetVariant, AssetVariants } from '@galaxie/db/schema';
import { imageInfo } from './image-info.js';
import { paletteFromPng } from './palette.js';
import { sizedLogos } from './sizes.js';
import { paletteFromSvg } from './svg-palette.js';
import { unsafeSvgReason } from './svg-safety.js';

export type CrestKind = 'team' | 'competition';

/** Tamanho máximo do arquivo enviado (o mesmo teto do conversor do acervo). */
export const CREST_MAX_BYTES = 5 * 1024 * 1024;
/** Lado do PNG/WebP principal: o "512" de `logo_sizes` é o próprio `png`/`webp` de `logo_formats`. */
export const CREST_RASTER_PX = 512;
/** Lado mínimo de um PNG/WebP enviado (abaixo disso o escudo fica borrado já no tamanho 128). */
export const CREST_MIN_PX = 128;

const EXTENSIONS: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Chave no storage (e na URL que a API devolve): só a nossa nomenclatura, com o tipo, o id do nosso time ou
 * competição e o começo do sha256, que troca a URL quando o escudo muda (o CDN guarda por uma semana).
 * Nunca leva o nome do acervo nem o do arquivo. null para tipo não aceito.
 */
export function crestStorageKey(
  kind: CrestKind,
  targetId: string,
  sha256: string,
  contentType: string,
): string | null {
  const ext = EXTENSIONS[contentType];
  if (!ext) return null;
  return `acervo/football/${kind === 'team' ? 'teams' : 'leagues'}/${targetId}.${sha256.slice(0, 12)}.${ext}`;
}

export type CrestErrorCode =
  'empty' | 'too_large' | 'unsupported_type' | 'unsafe_svg' | 'too_small' | 'unreadable';

/** Arquivo recusado (o código vira mensagem traduzida no painel). */
export class CrestError extends Error {
  constructor(
    readonly code: CrestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CrestError';
  }
}

/** Um objeto a gravar no storage. */
export interface CrestObject {
  key: string;
  body: Uint8Array;
  contentType: string;
  sha256: string;
}

export interface PreparedCrest {
  /** O arquivo servido em `logo`: o SVG, quando enviado, senão o PNG de 512 px. */
  storageKey: string;
  sha256: string;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  palette: AssetPalette | null;
  variants: AssetVariants;
  /** Tudo o que vai para o storage (principal, formatos e tamanhos), sem repetir chave. */
  objects: CrestObject[];
}

const sha256 = (buf: Uint8Array) => createHash('sha256').update(buf).digest('hex');
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * PNG de 512×512 com o escudo encaixado sem cortar e sobra transparente, como o 512 de `logo_sizes` promete.
 * O SVG é renderizado direto em 512; PNG/WebP menor não é ampliado, fica centralizado na tela de 512.
 */
async function rasterPng(body: Uint8Array, contentType: string): Promise<Uint8Array> {
  if (contentType === 'image/svg+xml') {
    // densidade que leva o lado maior do SVG a 512 px: renderiza nítido em vez de ampliar um bitmap pequeno
    const meta = await sharp(body).metadata();
    const side = Math.max(meta.width ?? 0, meta.height ?? 0) || CREST_RASTER_PX;
    const density = Math.min(Math.max((72 * CREST_RASTER_PX) / side, 1), 10_000);
    const png = await sharp(body, { density })
      .resize(CREST_RASTER_PX, CREST_RASTER_PX, { fit: 'contain', background: TRANSPARENT })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    return new Uint8Array(png);
  }
  // o 512 de `logo_sizes` é quadrado: reduz sem ampliar e centraliza numa tela de 512 transparente
  const { data, info } = await sharp(body)
    .resize(CREST_RASTER_PX, CREST_RASTER_PX, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const padX = CREST_RASTER_PX - info.width;
  const padY = CREST_RASTER_PX - info.height;
  const png = await sharp(data)
    .extend({
      left: Math.floor(padX / 2),
      right: Math.ceil(padX / 2),
      top: Math.floor(padY / 2),
      bottom: Math.ceil(padY / 2),
      background: TRANSPARENT,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return new Uint8Array(png);
}

/** Confere o arquivo e monta tudo o que o escudo precisa no storage e no banco. */
export async function prepareCrest(
  kind: CrestKind,
  targetId: string,
  input: Uint8Array,
): Promise<PreparedCrest> {
  if (!input.byteLength) throw new CrestError('empty', 'Arquivo vazio.');
  if (input.byteLength > CREST_MAX_BYTES)
    throw new CrestError('too_large', `Arquivo acima de ${CREST_MAX_BYTES / 1024 / 1024} MB.`);
  const info = imageInfo(input);
  if (!EXTENSIONS[info.contentType])
    throw new CrestError('unsupported_type', 'O arquivo não é SVG, PNG nem WebP.');
  const isSvg = info.contentType === 'image/svg+xml';
  if (isSvg) {
    const unsafe = unsafeSvgReason(input);
    if (unsafe) throw new CrestError('unsafe_svg', `SVG recusado: ${unsafe}`);
  }

  let png: Uint8Array;
  let webp: Uint8Array;
  let side: { width: number | null; height: number | null };
  try {
    if (!isSvg) {
      const meta = await sharp(input).metadata();
      if (Math.max(meta.width ?? 0, meta.height ?? 0) < CREST_MIN_PX)
        throw new CrestError(
          'too_small',
          `Imagem de ${meta.width}×${meta.height}: o mínimo é ${CREST_MIN_PX} px no lado maior.`,
        );
    }
    png = await rasterPng(input, info.contentType);
    webp = new Uint8Array(await sharp(png).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer());
    const meta = await sharp(png).metadata();
    side = { width: meta.width ?? null, height: meta.height ?? null };
  } catch (err) {
    if (err instanceof CrestError) throw err;
    throw new CrestError(
      'unreadable',
      `Não foi possível ler a imagem: ${String((err as Error)?.message ?? err)}`,
    );
  }

  const objects = new Map<string, CrestObject>();
  const add = (
    body: Uint8Array,
    contentType: string,
    width: number | null,
    height: number | null,
  ): AssetVariant => {
    const hash = sha256(body);
    const key = crestStorageKey(kind, targetId, hash, contentType)!;
    if (!objects.has(key)) objects.set(key, { key, body, contentType, sha256: hash });
    return { storage_key: key, sha256: hash, bytes: body.byteLength, width, height };
  };

  const variants: AssetVariants = {};
  if (isSvg) variants.svg = add(input, info.contentType, info.width, info.height);
  variants.png = add(png, 'image/png', side.width, side.height);
  variants.webp = add(webp, 'image/webp', side.width, side.height);
  for (const sized of await sizedLogos(png)) {
    const bySize = ((variants.sizes ??= {})[`${sized.size}`] ??= {});
    bySize[sized.format] = add(sized.body, sized.contentType, sized.size, sized.size);
  }

  const main = variants[(isSvg ? 'svg' : 'png') satisfies AssetFormat]!;
  return {
    storageKey: main.storage_key,
    sha256: main.sha256,
    contentType: isSvg ? 'image/svg+xml' : 'image/png',
    bytes: main.bytes,
    width: main.width,
    height: main.height,
    // a do PNG, como na importação (que usa o maior PNG do pacote); SVG sem PNG legível cai nas cores do SVG
    palette: paletteFromPng(png) ?? (isSvg ? paletteFromSvg(input) : null),
    variants,
    objects: [...objects.values()],
  };
}
