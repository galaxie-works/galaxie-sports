import type * as z from 'zod';
import { fromZodError, problems } from './errors.js';

/**
 * URL pública de um asset: nosso storage (`ASSETS_PUBLIC_BASE_URL` + storage_key) quando já foi
 * espelhado; senão, a URL de origem do fornecedor.
 */
export function assetUrl(
  baseUrl: string | undefined,
  storageKey: string | null | undefined,
  sourceUrl: string | null | undefined,
): string | null {
  if (storageKey && baseUrl) return `${baseUrl.replace(/\/$/, '')}/${storageKey.replace(/^\//, '')}`;
  return sourceUrl ?? null;
}

/**
 * Origem do logo publicada (`logo_source`): o acervo de logos, a Wikimedia Commons (logo de licença livre
 * de uma competição sem logo do fornecedor, publicado com `logo_credit`) ou o fornecedor.
 */
export function logoSource(origin: string | null | undefined): 'provider' | 'acervo' | 'commons' | null {
  if (origin == null) return null;
  return origin === 'acervo' || origin === 'commons' ? origin : 'provider';
}

/**
 * `logo_formats`: as URLs do mesmo escudo em SVG, PNG e WebP (`core.asset.variants`, gravado por
 * `assets:acervo`). null quando o asset não tem formatos (fornecedor, Commons) ou sem storage publicado.
 */
export function logoFormats(
  baseUrl: string | undefined,
  variants: Partial<Record<'svg' | 'png' | 'webp', { storage_key: string }>> | null | undefined,
): { svg: string | null; png: string | null; webp: string | null } | null {
  if (!variants || !baseUrl || !Object.keys(variants).length) return null;
  const url = (f: 'svg' | 'png' | 'webp') => assetUrl(baseUrl, variants[f]?.storage_key, null);
  return { svg: url('svg'), png: url('png'), webp: url('webp') };
}

type SizedVariant = Partial<Record<'png' | 'webp', { storage_key: string }>>;

/**
 * `logo_sizes`: o escudo do acervo em PNG e WebP nos tamanhos fixos (64/128/256 de `variants.sizes`; o
 * 512 é o `png`/`webp` de `variants`). null fora do acervo ou sem nenhum tamanho publicado.
 */
export function logoSizes(
  baseUrl: string | undefined,
  variants:
    | (Partial<Record<'png' | 'webp', { storage_key: string }>> & {
        sizes?: Partial<Record<'64' | '128' | '256', SizedVariant>>;
      })
    | null
    | undefined,
): Record<'64' | '128' | '256' | '512', { png: string | null; webp: string | null } | null> | null {
  if (!variants || !baseUrl) return null;
  const pair = (v: SizedVariant | undefined) => {
    const png = assetUrl(baseUrl, v?.png?.storage_key, null);
    const webp = assetUrl(baseUrl, v?.webp?.storage_key, null);
    return png || webp ? { png, webp } : null;
  };
  const out = {
    '64': pair(variants.sizes?.['64']),
    '128': pair(variants.sizes?.['128']),
    '256': pair(variants.sizes?.['256']),
    '512': pair(variants),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

/** Licença para comparar: minúsculas, hífen e espaço iguais ("CC-BY-4.0" = "cc by 4.0"). */
const licenseKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();

/**
 * "Logo: Fulano / Wikimedia Commons · CC BY-SA 4.0" (sem autor: só a fonte e a licença). Com a atribuição pedida
 * pelo autor (`Attribution` da Commons), ela no lugar do autor e da fonte: "Logo: <atribuição> · CC BY 4.0".
 */
export function logoCreditText(author: string | null, license: string, attribution?: string | null): string {
  // a atribuição pedida pelo autor é o texto que a licença manda exibir; a licença vai junto, se ela não citar
  if (attribution)
    return licenseKey(attribution).includes(licenseKey(license))
      ? `Logo: ${attribution}`
      : `Logo: ${attribution} · ${license}`;
  return `Logo: ${author ? `${author} / ` : ''}Wikimedia Commons · ${license}`;
}

/** Saída validada de cada objeto de entrada (ex.: `request.query`), para a chave do cache. */
const validated = new WeakMap<object, unknown>();

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valida query/params com um schema Zod; erro → 400 INVALID_PARAMS. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw fromZodError(r.error);
  if (typeof input === 'object' && input !== null) {
    // mais de um schema sobre a mesma entrada: a chave do cache vê a união dos campos validados
    const prev = validated.get(input);
    validated.set(input, isPlainObject(prev) && isPlainObject(r.data) ? { ...prev, ...r.data } : r.data);
  }
  return r.data;
}

/**
 * O que `parseInput` aceitou desta entrada (só os campos do schema, já normalizados), ou `undefined` se ela
 * nunca foi validada. A chave do cache usa isto no lugar da query bruta: parâmetro desconhecido não fura o cache.
 */
export function validatedInput(input: unknown): unknown {
  return typeof input === 'object' && input !== null ? validated.get(input) : undefined;
}

/** Cursor opaco (base64url de JSON). */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T extends z.ZodType>(schema: T, cursor: string): z.output<T> {
  try {
    const r = schema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (r.success) return r.data;
  } catch {
    // cai no erro abaixo
  }
  throw problems.invalidParams([{ path: 'cursor', message: 'cursor inválido' }]);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapa curingas do LIKE (% e _) em texto do usuário. */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
