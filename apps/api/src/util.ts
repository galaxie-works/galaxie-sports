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
 * Origem do logo publicada (`logo_source`): o acervo de logos ou o fornecedor. Fotos da Commons
 * (`origin = commons`) nunca são logo; se um dia forem, contam como fornecedor, sem mudar o contrato.
 */
export function logoSource(origin: string | null | undefined): 'provider' | 'acervo' | null {
  if (origin == null) return null;
  return origin === 'acervo' ? 'acervo' : 'provider';
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
