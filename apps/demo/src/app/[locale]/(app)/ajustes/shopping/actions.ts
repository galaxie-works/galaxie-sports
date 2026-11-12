'use server';

/**
 * Ações de Ajustes → Engajamento → Shopping (#914), só admin da Galaxie: lojas, ficha da entidade, jeito de achar
 * os produtos em cada loja e os produtos âncora (incluir, corrigir, ligar/desligar, ordenar, aprovar sugestão). A
 * sessão de admin é conferida de novo no servidor e cada gravação leva quem fez.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import {
  ShopCatalogError,
  addShopProduct,
  moveShopProduct,
  removeShopLookup,
  reviewShopProduct,
  saveShopLookup,
  saveShopProfile,
  saveShopStore,
  setShopProductActive,
  updateShopProduct,
} from '@/lib/shop/catalog';
import {
  isShopEntityRef,
  parseLookupInput,
  parseProductInput,
  parseProfileInput,
  parseStoreInput,
  type Parsed,
} from '@/lib/shop/catalog-input';

export interface ShopActionResult {
  ok: boolean;
  error?: string;
}

const PATH = '/ajustes/shopping';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EntityRef {
  kind: string;
  id: string;
}

async function run(ref: EntityRef | null, fn: (actor: string) => Promise<void>): Promise<ShopActionResult> {
  const me = await requireAdmin();
  const t = getDictionary(await getRequestLocale()).shopping.errors;
  try {
    await fn(`galaxie:${me.id}`);
  } catch (err) {
    if (err instanceof ShopCatalogError) return { ok: false, error: t[err.code] };
    if (err instanceof InputError) return { ok: false, error: t.input[err.code] };
    console.error('ajustes/shopping: gravação falhou', err);
    return { ok: false, error: t.generic };
  }
  revalidatePath(PATH);
  if (ref) revalidatePath(`${PATH}/${ref.kind}/${ref.id}`);
  return { ok: true };
}

class InputError extends Error {
  constructor(readonly code: Extract<Parsed<unknown>, { ok: false }>['error']) {
    super(code);
  }
}

function value<T>(p: Parsed<T>): T {
  if (!p.ok) throw new InputError(p.error);
  return p.value;
}

function entity(ref: EntityRef) {
  if (!isShopEntityRef(ref?.kind, ref?.id)) throw new InputError('entity');
  return { kind: ref.kind, id: ref.id };
}

function productId(id: unknown): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new ShopCatalogError('not_found');
  return id;
}

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export async function saveStoreAction(input: Record<string, unknown>): Promise<ShopActionResult> {
  return run(null, (actor) => saveShopStore(value(parseStoreInput(obj(input))), actor));
}

export async function saveProfileAction(
  ref: EntityRef,
  input: Record<string, unknown>,
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    const e = entity(ref);
    await saveShopProfile(e.kind, e.id, value(parseProfileInput(obj(input))), actor);
  });
}

export async function saveLookupAction(
  ref: EntityRef,
  input: Record<string, unknown>,
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    const e = entity(ref);
    await saveShopLookup(e.kind, e.id, value(parseLookupInput(obj(input))), actor);
  });
}

export async function removeLookupAction(ref: EntityRef, storeId: string): Promise<ShopActionResult> {
  return run(ref, async () => {
    const e = entity(ref);
    await removeShopLookup(e.kind, e.id, String(storeId ?? '').slice(0, 40));
  });
}

export async function addProductAction(
  ref: EntityRef,
  input: Record<string, unknown>,
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    const e = entity(ref);
    await addShopProduct(e.kind, e.id, value(parseProductInput(obj(input))), actor);
  });
}

export async function updateProductAction(
  ref: EntityRef,
  id: string,
  input: Record<string, unknown>,
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    entity(ref);
    // a loja e o id na loja não mudam: só para passar na mesma validação
    const p = value(parseProductInput({ ...obj(input), storeId: 'xx', storeProductId: 'x' }));
    await updateShopProduct(productId(id), p, actor);
  });
}

export async function setProductActiveAction(
  ref: EntityRef,
  id: string,
  active: boolean,
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    entity(ref);
    await setShopProductActive(productId(id), active === true, actor);
  });
}

export async function reviewProductAction(
  ref: EntityRef,
  id: string,
  verdict: 'approved' | 'rejected',
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    entity(ref);
    await reviewShopProduct(productId(id), verdict === 'approved' ? 'approved' : 'rejected', actor);
  });
}

export async function moveProductAction(
  ref: EntityRef,
  id: string,
  direction: 'up' | 'down',
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    entity(ref);
    await moveShopProduct(productId(id), direction === 'up' ? 'up' : 'down', actor);
  });
}
