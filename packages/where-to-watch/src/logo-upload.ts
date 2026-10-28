/**
 * Logo enviado no painel (Ajustes → Grades e ofertas) para uma plataforma da grade ou uma entrada da
 * biblioteca de emissoras (canal ou streaming):
 *
 * 1. valida pelo conteúdo, não pela extensão nem pelo tipo que o navegador declarou: só PNG (assinatura e
 *    cabeçalho IHDR, com dimensões mínimas) ou SVG; tamanho máximo;
 * 2. SVG passa por uma sanitização por allowlist (elementos e atributos de desenho): sai todo `<script>`,
 *    `<foreignObject>`, animação, evento `on*`, `href` que não seja âncora local (`#id`) e `url(...)`
 *    externo em estilo; DOCTYPE/ENTITY recusa o arquivo;
 * 3. grava no mesmo storage e com o mesmo padrão de nome dos outros logos (conteúdo endereçável, sem nome
 *    de marca): `broadcasters/<sha256[0..16]>.<ext>` (biblioteca, como `logoStorageKey` do ingestor) e
 *    `platforms/<sha256[0..16]>.<ext>` (plataforma, como o `PLATFORM_LOGO_PREFIX`);
 * 4. registra o asset e liga na entidade (`setCustomLogo` de `@galaxie/db`), que publica a mudança no
 *    change feed (a API purga as respostas que mostram o logo) e guarda o anterior para voltar.
 */
import { createHash } from 'node:crypto';
import type { Database } from '@galaxie/db/client';
import { setCustomLogo, type LogoTargetRef } from '@galaxie/db/lineups';

/** Tamanho máximo do arquivo enviado. */
export const LOGO_UPLOAD_MAX_BYTES = 512 * 1024;
/** Lado mínimo do PNG (o card mostra o logo a ~56 px; sobra para telas densas). */
export const LOGO_UPLOAD_MIN_PX = 128;
/** Lado máximo do PNG (evita imagem gigante descomprimida no navegador). */
export const LOGO_UPLOAD_MAX_PX = 4096;

/** Prefixos das chaves no bucket, os mesmos do ingestor (`BROADCASTER_LOGO_PREFIX`, `PLATFORM_LOGO_PREFIX`). */
export const LOGO_UPLOAD_PREFIX = { broadcaster: 'broadcasters', platform: 'platforms' } as const;

export type LogoUploadErrorCode =
  'empty' | 'too_large' | 'unsupported_type' | 'too_small' | 'too_big_dimensions' | 'invalid_svg';

/** Arquivo recusado (o código vira mensagem traduzida no painel). */
export class LogoUploadError extends Error {
  constructor(
    readonly code: LogoUploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LogoUploadError';
  }
}

export interface ValidatedLogo {
  contentType: 'image/png' | 'image/svg+xml';
  /** Bytes a gravar (o SVG já sanitizado). */
  body: Uint8Array;
  width: number | null;
  height: number | null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Valida o arquivo pelo conteúdo e devolve o que gravar (SVG sanitizado). */
export function validateLogoUpload(input: Uint8Array): ValidatedLogo {
  if (!input.byteLength) throw new LogoUploadError('empty', 'Arquivo vazio.');
  if (input.byteLength > LOGO_UPLOAD_MAX_BYTES)
    throw new LogoUploadError('too_large', `Arquivo acima de ${LOGO_UPLOAD_MAX_BYTES / 1024} KB.`);
  if (PNG_SIGNATURE.every((b, i) => input[i] === b)) return validatePng(input);
  const text = decodeUtf8(input);
  if (text !== null && looksLikeSvg(text)) {
    const svg = sanitizeSvg(text);
    const body = new TextEncoder().encode(svg.markup);
    return { contentType: 'image/svg+xml', body, width: svg.width, height: svg.height };
  }
  throw new LogoUploadError('unsupported_type', 'O arquivo não é PNG nem SVG.');
}

function validatePng(buf: Uint8Array): ValidatedLogo {
  // assinatura (8) + tamanho do bloco (4) + "IHDR" (4) + largura (4) + altura (4)
  const isIhdr = buf.byteLength >= 33 && String.fromCharCode(...buf.subarray(12, 16)) === 'IHDR';
  if (!isIhdr) throw new LogoUploadError('unsupported_type', 'PNG sem cabeçalho IHDR.');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < LOGO_UPLOAD_MIN_PX || height < LOGO_UPLOAD_MIN_PX)
    throw new LogoUploadError(
      'too_small',
      `PNG de ${width}×${height}: o mínimo é ${LOGO_UPLOAD_MIN_PX}×${LOGO_UPLOAD_MIN_PX} px.`,
    );
  if (width > LOGO_UPLOAD_MAX_PX || height > LOGO_UPLOAD_MAX_PX)
    throw new LogoUploadError('too_big_dimensions', `PNG acima de ${LOGO_UPLOAD_MAX_PX} px.`);
  return { contentType: 'image/png', body: buf, width, height };
}

function decodeUtf8(buf: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

/** Começa com `<svg` depois da declaração XML, de comentários e de espaço (DOCTYPE vem aqui e é recusado). */
function looksLikeSvg(text: string): boolean {
  const head = text
    .slice(0, 4096)
    .replace(/^\s*<\?xml[\s\S]*?\?>/, '')
    .replace(/^(\s*<!--[\s\S]*?-->)+/, '')
    .trimStart();
  return /^<svg[\s>]/i.test(head) || /^<!DOCTYPE\s+svg/i.test(head);
}

// ─── sanitização do SVG ──────────────────────────────────────────────────────────────────────────

/** Elementos de desenho aceitos; qualquer outro sai com tudo o que tem dentro. */
const SVG_ELEMENTS = new Set(
  [
    'svg',
    'g',
    'defs',
    'symbol',
    'use',
    'title',
    'desc',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'textPath',
    'linearGradient',
    'radialGradient',
    'stop',
    'clipPath',
    'mask',
    'pattern',
    'filter',
    'feBlend',
    'feColorMatrix',
    'feComposite',
    'feFlood',
    'feGaussianBlur',
    'feMerge',
    'feMergeNode',
    'feOffset',
    'style',
  ].map((e) => e.toLowerCase()),
);

const ATTR_NAME_RE = /^[A-Za-z_][\w:.-]*$/;
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Entidades numéricas e as cinco do XML, para conferir o valor como o navegador o leria. */
function decodeEntities(v: string): string {
  const cp = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\uFFFD');
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, n: string) => cp(parseInt(n, 16)))
    .replace(/&#(\d+);?/g, (_, n: string) => cp(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * CSS sem `@import`, sem `url(...)` que não seja âncora local, sem `expression(` e sem `javascript:`.
 * Escape CSS (`\70`, `\:`) é recusado: o navegador o decodifica (`@im\70 ort` = `@import`) e um logo não
 * precisa dele.
 */
function unsafeCss(css: string): boolean {
  const decoded = decodeEntities(css);
  if (decoded.includes('\\')) return true;
  const c = decoded.replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
  return (
    c.includes('@import') ||
    c.includes('expression(') ||
    c.includes('javascript:') ||
    c.includes('behavior:') ||
    c.includes('-moz-binding') ||
    /url\(\s*(?!['"]?\s*#)/.test(c)
  );
}

/** O atributo fica? (nome válido, sem evento, href só local, estilo e valores sem esquema perigoso). */
function keepAttribute(name: string, rawValue: string): boolean {
  if (!ATTR_NAME_RE.test(name)) return false;
  const n = name.toLowerCase();
  if (n.startsWith('on')) return false;
  const value = decodeEntities(rawValue);
  // eslint-disable-next-line no-control-regex
  const compact = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
  if (n === 'href' || n.endsWith(':href')) return /^#[\w.:-]+$/.test(value.trim());
  if (n === 'xmlns') return value === SVG_NS;
  if (n === 'xmlns:xlink') return value === XLINK_NS;
  // outros prefixos (editores: `sodipodi:`, `inkscape:`) saem junto com a declaração deles
  if (n.includes(':') && !n.startsWith('xlink:') && !n.startsWith('xml:')) return false;
  if (n === 'style') return !unsafeCss(value);
  // valor de atributo de apresentação também é CSS: escape (`u\72l(`) esconderia um url() externo
  if (value.includes('\\')) return false;
  if (/^(javascript|vbscript|data):/.test(compact)) return false;
  // url(...) externo em atributo de apresentação (fill="url(https://…)")
  if (/url\(/i.test(value) && !/^url\(\s*['"]?#[\w.:-]+['"]?\s*\)$/i.test(value.trim())) return false;
  return true;
}

const escapeAttr = (v: string) =>
  v.replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z]+);)/gi, '&amp;').replace(/"/g, '&quot;');

const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!([A-Za-z][^>]*)>|<\/\s*([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[^\s=/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)|(<)/g;
const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

export interface SanitizedSvg {
  markup: string;
  width: number | null;
  height: number | null;
}

/**
 * SVG reescrito só com elementos e atributos de desenho (allowlist). Recusa (erro `invalid_svg`) DOCTYPE e
 * ENTITY, marcação malformada, raiz que não é `<svg>` e resultado sem nada desenhável.
 */
export function sanitizeSvg(input: string): SanitizedSvg {
  const out: string[] = [];
  const stack: string[] = [];
  /** Profundidade dentro de um elemento descartado (tudo dentro dele sai). */
  let skipping = 0;
  let root = false;
  let width: number | null = null;
  let height: number | null = null;
  let inStyle = false;
  for (const m of input.matchAll(TOKEN_RE)) {
    const [whole, cdata, decl, closeName, openName, attrs, selfClose, text, stray] = m;
    if (stray !== undefined) throw new LogoUploadError('invalid_svg', 'SVG malformado.');
    if (decl !== undefined)
      throw new LogoUploadError('invalid_svg', 'SVG com DOCTYPE ou ENTITY não é aceito.');
    if (whole.startsWith('<!--') || whole.startsWith('<?')) continue;
    if (cdata !== undefined) {
      // só como conteúdo de <style> (conferido como CSS); fora dele, descartado
      if (!skipping && inStyle) {
        if (unsafeCss(cdata))
          throw new LogoUploadError('invalid_svg', 'Estilo do SVG com referência externa.');
        out.push(cdata.replace(/</g, '&lt;'));
      }
      continue;
    }
    if (text !== undefined) {
      if (skipping || !root) continue;
      if (inStyle && unsafeCss(text))
        throw new LogoUploadError('invalid_svg', 'Estilo do SVG com referência externa.');
      out.push(text);
      continue;
    }
    if (closeName !== undefined) {
      const name = closeName.toLowerCase();
      if (stack.at(-1) !== name) throw new LogoUploadError('invalid_svg', 'SVG malformado.');
      stack.pop();
      if (skipping) {
        skipping--;
        continue;
      }
      if (name === 'style') inStyle = false;
      out.push(`</${closeName}>`);
      continue;
    }
    // abertura
    const name = openName!.toLowerCase();
    const selfClosing = selfClose === '/';
    if (!root) {
      if (name !== 'svg') throw new LogoUploadError('invalid_svg', 'A raiz do arquivo não é <svg>.');
      root = true;
    } else if (!stack.length) {
      throw new LogoUploadError('invalid_svg', 'Conteúdo fora do <svg>.');
    }
    if (skipping || !SVG_ELEMENTS.has(name)) {
      if (!selfClosing) {
        stack.push(name);
        skipping++;
      }
      continue;
    }
    const kept: string[] = [];
    for (const a of (attrs ?? '').matchAll(ATTR_RE)) {
      const attrName = a[1]!;
      const value = a[2] ?? a[3] ?? '';
      if (!keepAttribute(attrName, value)) continue;
      kept.push(`${attrName}="${escapeAttr(value)}"`);
    }
    if (name === 'svg' && stack.length === 0) {
      if (!kept.some((k) => k.startsWith('xmlns='))) kept.unshift(`xmlns="${SVG_NS}"`);
      const get = (k: string) =>
        (attrs ?? '').match(new RegExp(`\\s${k}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
      const num = (v: string | undefined) => {
        const n = v ? /^\s*([\d.]+)\s*(px)?\s*$/i.exec(v)?.[1] : undefined;
        return n ? Math.round(Number(n)) : null;
      };
      width = num(get('width'));
      height = num(get('height'));
      const vb = get('viewBox')
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
      if ((width === null || height === null) && vb?.length === 4 && vb.every(Number.isFinite)) {
        width ??= Math.round(vb[2]!);
        height ??= Math.round(vb[3]!);
      }
    }
    out.push(`<${openName}${kept.length ? ` ${kept.join(' ')}` : ''}${selfClosing ? '/>' : '>'}`);
    if (!selfClosing) {
      stack.push(name);
      if (name === 'style') inStyle = true;
    }
  }
  if (!root || stack.length) throw new LogoUploadError('invalid_svg', 'SVG malformado.');
  const markup = out.join('').trim();
  if (!/<(path|rect|circle|ellipse|line|polyline|polygon|text|use)\b/i.test(markup))
    throw new LogoUploadError('invalid_svg', 'SVG sem nada desenhável.');
  return { markup, width, height };
}

// ─── nome e gravação ─────────────────────────────────────────────────────────────────────────────

const EXT = { 'image/png': 'png', 'image/svg+xml': 'svg' } as const;

/** Chave no bucket no padrão dos logos: `<prefixo>/<sha256[0..16]>.<ext>`. */
export function logoUploadStorageKey(
  target: LogoTargetRef['type'],
  sha256: string,
  contentType: ValidatedLogo['contentType'],
): string {
  return `${LOGO_UPLOAD_PREFIX[target]}/${sha256.slice(0, 16)}.${EXT[contentType]}`;
}

/** O mínimo do object storage que o upload usa (o S3ObjectStore do ingestor e o da demo cumprem). */
export interface LogoObjectStore {
  put(key: string, body: Uint8Array, contentType: string, sha256: string): Promise<void>;
}

export interface UploadLogoResult {
  assetId: string;
  previousAssetId: string | null;
  storageKey: string;
  contentType: ValidatedLogo['contentType'];
  width: number | null;
  height: number | null;
}

/**
 * Valida, sanitiza, grava no storage e liga o logo na entidade. Erro `LogoUploadError` para arquivo
 * recusado; `LineupError` (`target_not_found`) se a entidade não existe (o arquivo já gravado fica: a
 * chave é o hash, sem lixo com nome).
 */
export async function uploadLogo(
  db: Database,
  objects: LogoObjectStore,
  input: { target: LogoTargetRef; body: Uint8Array; by: string },
): Promise<UploadLogoResult> {
  const logo = validateLogoUpload(input.body);
  const sha256 = createHash('sha256').update(logo.body).digest('hex');
  const storageKey = logoUploadStorageKey(input.target.type, sha256, logo.contentType);
  await objects.put(storageKey, logo.body, logo.contentType, sha256);
  const linked = await setCustomLogo(
    db,
    input.target,
    {
      storageKey,
      sha256,
      contentType: logo.contentType,
      bytes: logo.body.byteLength,
      width: logo.width,
      height: logo.height,
    },
    input.by,
  );
  return {
    assetId: linked.assetId,
    previousAssetId: linked.previousAssetId,
    storageKey,
    contentType: logo.contentType,
    width: logo.width,
    height: logo.height,
  };
}
