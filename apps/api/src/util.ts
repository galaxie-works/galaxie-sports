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
 * "Logo: Fulano / Wikimedia Commons · CC BY-SA 4.0" (sem autor: só a fonte e a licença). Com a atribuição pedida
 * pelo autor (`Attribution` da Commons), ela no lugar do autor e da fonte: "Logo: <atribuição> · CC BY 4.0".
 */
export function logoCreditText(author: string | null, license: string, attribution?: string | null): string {
  // a atribuição pedida pelo autor é o texto que a licença manda exibir; a licença vai junto, se ela não citar
  if (attribution)
    return attribution.toLowerCase().includes(license.toLowerCase())
      ? `Logo: ${attribution}`
      : `Logo: ${attribution} · ${license}`;
  return `Logo: ${author ? `${author} / ` : ''}Wikimedia Commons · ${license}`;
}

/** Valida query/params com um schema Zod; erro → 400 INVALID_PARAMS. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw fromZodError(r.error);
  return r.data;
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
