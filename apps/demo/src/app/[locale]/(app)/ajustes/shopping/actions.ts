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
  parseConnectorInput,
  parseCredentialsInput,
} from '@/lib/shop/catalog-input';
import {
  ShopSecretError,
  clearShopCredentials,
  saveShopConnector,
  saveShopCredentials,
  setShopStoreActive,
  storeNetwork,
} from '@/lib/shop/connectors';

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
    if (err instanceof ShopSecretError) return { ok: false, error: t.no_kek };
    // só o nome e o código: a mensagem do driver pode citar parâmetros (e as credenciais cifradas)
    console.error(
      'ajustes/shopping: gravação falhou',
      err instanceof Error ? err.name : 'erro',
      (err as { code?: string })?.code,
    );
    return { ok: false, error: t.generic };
  }
  revalidatePath(PATH);
  revalidatePath(`${PATH}/conectores`);
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

export async function saveStoreAction(
  input: Record<string, unknown>,
  create: boolean,
): Promise<ShopActionResult> {
  return run(null, (actor) =>
    saveShopStore(value(parseStoreInput(obj(input))), actor, { create: create === true }),
  );
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
    const e = entity(ref);
    // a loja e o id na loja não mudam: só para passar na mesma validação
    const p = value(parseProductInput({ ...obj(input), storeId: 'xx', storeProductId: 'x' }));
    await updateShopProduct(e.kind, e.id, productId(id), p, actor);
  });
}

export async function setProductActiveAction(
  ref: EntityRef,
  id: string,
  active: boolean,
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    const e = entity(ref);
    await setShopProductActive(e.kind, e.id, productId(id), active === true, actor);
  });
}

export async function reviewProductAction(
  ref: EntityRef,
  id: string,
  verdict: 'approved' | 'rejected',
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    const e = entity(ref);
    await reviewShopProduct(
      e.kind,
      e.id,
      productId(id),
      verdict === 'approved' ? 'approved' : 'rejected',
      actor,
    );
  });
}

export async function moveProductAction(
  ref: EntityRef,
  id: string,
  direction: 'up' | 'down',
): Promise<ShopActionResult> {
  return run(ref, async (actor) => {
    const e = entity(ref);
    await moveShopProduct(e.kind, e.id, productId(id), direction === 'up' ? 'up' : 'down', actor);
  });
}

// ── Conectores (#916) ────────────────────────────────────────────────────────────────────────────────────────────

const storeId = (id: unknown) => {
  if (typeof id !== 'string' || !/^[a-z0-9_]{2,40}$/.test(id)) throw new InputError('store_id');
  return id;
};

export async function setStoreActiveAction(id: string, active: boolean): Promise<ShopActionResult> {
  return run(null, (actor) => setShopStoreActive(storeId(id), active === true, actor));
}

export async function saveConnectorAction(
  id: string,
  input: Record<string, unknown>,
): Promise<ShopActionResult> {
  return run(null, async (actor) => {
    const sid = storeId(id);
    await saveShopConnector(sid, value(parseConnectorInput(await storeNetwork(sid), obj(input))), actor);
  });
}

/** Grava as credenciais (cifradas). O valor nunca volta nem vai para log. */
export async function saveCredentialsAction(
  id: string,
  input: Record<string, unknown>,
): Promise<ShopActionResult> {
  return run(null, (actor) =>
    saveShopCredentials(storeId(id), value(parseCredentialsInput(obj(input))), actor),
  );
}

export async function clearCredentialsAction(id: string): Promise<ShopActionResult> {
  return run(null, (actor) => clearShopCredentials(storeId(id), actor));
}
