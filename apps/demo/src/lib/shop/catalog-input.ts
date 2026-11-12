/**
 * Regras de entrada da curadoria do Shopping (#914), puras: valem no navegador (formulário) e no servidor (ação). As
 * listas repetem as do banco (`@galaxie/db`, `schema/shop.ts`); o teste confere que não se separaram.
 */

export const SHOP_ENTITY_KINDS = ['competition', 'participant', 'person'] as const;
export type ShopEntityKind = (typeof SHOP_ENTITY_KINDS)[number];

export const SHOP_NETWORKS = ['amazon', 'awin', 'direct', 'impact', 'mercado_livre'] as const;
export type ShopNetwork = (typeof SHOP_NETWORKS)[number];

export const SHOP_LOOKUP_KINDS = [
  'category',
  'official_seller',
  'product_list',
  'team_page',
  'team_slug',
] as const;
export type ShopLookupKind = (typeof SHOP_LOOKUP_KINDS)[number];

export const SHOP_PRODUCT_TYPES = [
  'away_kit',
  'ball',
  'cap',
  'champion',
  'commemorative',
  'home_kit',
  'jacket',
  'mug',
  'other',
  'scarf',
  'third_kit',
  'training',
] as const;
export type ShopProductType = (typeof SHOP_PRODUCT_TYPES)[number];

export const SHOP_PRODUCT_STATUSES = ['approved', 'rejected', 'suggested'] as const;
export type ShopProductStatus = (typeof SHOP_PRODUCT_STATUSES)[number];

/** Quantos produtos âncora por entidade a curadoria busca (#914: 6 a 12). */
export const ANCHORS_MIN = 6;
export const ANCHORS_MAX = 12;

export type ShopInputError =
  | 'store_id'
  | 'store_name'
  | 'country'
  | 'network'
  | 'url'
  | 'kind'
  | 'entity'
  | 'lookup_kind'
  | 'lookup_value'
  | 'product_id'
  | 'product_type'
  | 'title'
  | 'season'
  | 'kit_brand'
  | 'subnetwork'
  | 'advertiser_id'
  | 'link_template'
  | 'affiliate_id'
  | 'api_token'
  | 'client_code';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ShopInputError };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEASON = /^[0-9]{4}(\/[0-9]{2})?$/;
const STORE_ID = /^[a-z0-9_]{2,40}$/;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const optional = (v: unknown) => str(v) || null;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/** Link https sem credencial e sem porta; o resto (parâmetros de afiliado) quem põe é o conector. */
export function cleanHttpsUrl(raw: unknown): string | null {
  const s = str(raw);
  if (!s || s.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  return u.toString();
}

export const isShopEntityRef = (kind: unknown, id: unknown): kind is ShopEntityKind =>
  isOneOf(SHOP_ENTITY_KINDS, kind) && typeof id === 'string' && UUID.test(id);

export interface StoreInput {
  id: string;
  name: string;
  country: string;
  network: ShopNetwork;
  homeUrl: string | null;
  position: number;
}

export function parseStoreInput(raw: Record<string, unknown>): Parsed<StoreInput> {
  const id = str(raw.id).toLowerCase();
  if (!STORE_ID.test(id)) return { ok: false, error: 'store_id' };
  const name = str(raw.name);
  if (name.length < 2 || name.length > 60) return { ok: false, error: 'store_name' };
  const country = str(raw.country).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, error: 'country' };
  if (!isOneOf(SHOP_NETWORKS, raw.network)) return { ok: false, error: 'network' };
  let homeUrl: string | null = null;
  if (str(raw.homeUrl)) {
    homeUrl = cleanHttpsUrl(raw.homeUrl);
    if (!homeUrl) return { ok: false, error: 'url' };
  }
  const n = Number(raw.position ?? 0);
  const position = Number.isInteger(n) && n >= 0 && n <= 999 ? n : 0;
  return { ok: true, value: { id, name, country, network: raw.network, homeUrl, position } };
}

export interface ProfileInput {
  kitBrand: string | null;
  kitSeason: string | null;
  reviewedSeason: string | null;
}

export function parseProfileInput(raw: Record<string, unknown>): Parsed<ProfileInput> {
  const kitBrand = optional(raw.kitBrand);
  if (kitBrand && (kitBrand.length < 2 || kitBrand.length > 40)) return { ok: false, error: 'kit_brand' };
  const kitSeason = optional(raw.kitSeason);
  const reviewedSeason = optional(raw.reviewedSeason);
  if ((kitSeason && !SEASON.test(kitSeason)) || (reviewedSeason && !SEASON.test(reviewedSeason)))
    return { ok: false, error: 'season' };
  return { ok: true, value: { kitBrand, kitSeason, reviewedSeason } };
}

export interface LookupInput {
  storeId: string;
  lookupKind: ShopLookupKind;
  lookupValue: string;
  pageUrl: string | null;
}

export function parseLookupInput(raw: Record<string, unknown>): Parsed<LookupInput> {
  const storeId = str(raw.storeId);
  if (!STORE_ID.test(storeId)) return { ok: false, error: 'store_id' };
  if (!isOneOf(SHOP_LOOKUP_KINDS, raw.lookupKind)) return { ok: false, error: 'lookup_kind' };
  const lookupValue = str(raw.lookupValue);
  if (!lookupValue || lookupValue.length > 500) return { ok: false, error: 'lookup_value' };
  let pageUrl: string | null = null;
  if (str(raw.pageUrl)) {
    pageUrl = cleanHttpsUrl(raw.pageUrl);
    if (!pageUrl) return { ok: false, error: 'url' };
  }
  return { ok: true, value: { storeId, lookupKind: raw.lookupKind, lookupValue, pageUrl } };
}

export interface ProductInput {
  storeId: string;
  storeProductId: string;
  productType: ShopProductType;
  title: string;
  season: string | null;
  url: string;
}

export function parseProductInput(raw: Record<string, unknown>): Parsed<ProductInput> {
  const storeId = str(raw.storeId);
  if (!STORE_ID.test(storeId)) return { ok: false, error: 'store_id' };
  const storeProductId = str(raw.storeProductId);
  if (!storeProductId || storeProductId.length > 120) return { ok: false, error: 'product_id' };
  if (!isOneOf(SHOP_PRODUCT_TYPES, raw.productType)) return { ok: false, error: 'product_type' };
  const title = str(raw.title);
  if (title.length < 2 || title.length > 160) return { ok: false, error: 'title' };
  const season = optional(raw.season);
  if (season && !SEASON.test(season)) return { ok: false, error: 'season' };
  const url = cleanHttpsUrl(raw.url);
  if (!url) return { ok: false, error: 'url' };
  return { ok: true, value: { storeId, storeProductId, productType: raw.productType, title, season, url } };
}

/**
 * Nova ordem depois de subir ou descer um produto dentro da mesma loja: posições 0..n-1, sem buraco. Devolve null
 * quando não há o que mover (primeiro subindo, último descendo, id fora da lista).
 */
export function moveInOrder(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const i = ids.indexOf(id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

// ── Conectores (#916) ───────────────────────────────────────────────────────────────────────────────────────────

export const SHOP_CLIENT_PATHS = ['client_code', 'subnetwork'] as const;
export type ShopClientPath = (typeof SHOP_CLIENT_PATHS)[number];
/** Redes com repasse por sub-rede (Amazon e Mercado Livre não permitem). */
export const SUBNETWORK_NETWORKS: readonly ShopNetwork[] = ['awin', 'direct', 'impact'];
/** Redes cujo link vem de um modelo do programa (`{url}`, `{code}`, `{clickref}`). */
export const TEMPLATE_NETWORKS: readonly ShopNetwork[] = ['direct', 'impact'];

const TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

export interface ConnectorInput {
  clientPaths: ShopClientPath[];
  config: { advertiserId?: string; linkTemplate?: string };
}

export function parseConnectorInput(
  network: ShopNetwork,
  raw: Record<string, unknown>,
): Parsed<ConnectorInput> {
  const paths = Array.isArray(raw.clientPaths) ? raw.clientPaths : [];
  const clientPaths = SHOP_CLIENT_PATHS.filter((p) => paths.includes(p));
  if (clientPaths.includes('subnetwork') && !SUBNETWORK_NETWORKS.includes(network))
    return { ok: false, error: 'subnetwork' };
  // o modelo do link é da conta da Galaxie: o código do cliente não cabe nele
  if (clientPaths.includes('client_code') && TEMPLATE_NETWORKS.includes(network))
    return { ok: false, error: 'client_code' };
  const config: ConnectorInput['config'] = {};
  const advertiserId = str(raw.advertiserId);
  if (network === 'awin') {
    // sem o anunciante, a Awin não gera link nenhum
    if (!TOKEN.test(advertiserId)) return { ok: false, error: 'advertiser_id' };
    config.advertiserId = advertiserId;
  }
  const linkTemplate = str(raw.linkTemplate);
  if (TEMPLATE_NETWORKS.includes(network) && linkTemplate) {
    if (
      !linkTemplate.includes('{url}') ||
      !linkTemplate.includes('{code}') ||
      (clientPaths.includes('subnetwork') && !linkTemplate.includes('{clickref}')) ||
      !cleanHttpsUrl(linkTemplate.replace(/\{[a-z]+\}/g, 'x'))
    )
      return { ok: false, error: 'link_template' };
    config.linkTemplate = linkTemplate;
  }
  return { ok: true, value: { clientPaths, config } };
}

export interface CredentialsInput {
  affiliateId?: string;
  affiliateTool?: string;
  apiToken?: string;
  apiSecret?: string;
}

/**
 * Código e ferramenta de afiliado no formato curto; token e segredo da API como vierem (até 2.000 caracteres). Campo
 * vazio não muda o que está gravado (a tela é só de gravação e começa vazia).
 */
export function parseCredentialsInput(raw: Record<string, unknown>): Parsed<CredentialsInput> {
  const out: CredentialsInput = {};
  const affiliateId = str(raw.affiliateId);
  if (affiliateId) {
    if (!TOKEN.test(affiliateId)) return { ok: false, error: 'affiliate_id' };
    out.affiliateId = affiliateId;
  }
  const affiliateTool = str(raw.affiliateTool);
  if (affiliateTool) {
    if (!TOKEN.test(affiliateTool)) return { ok: false, error: 'affiliate_id' };
    out.affiliateTool = affiliateTool;
  }
  for (const k of ['apiToken', 'apiSecret'] as const) {
    const v = str(raw[k]);
    if (v.length > 2000 || /\s/.test(v)) return { ok: false, error: 'api_token' };
    if (v) out[k] = v;
  }
  return { ok: true, value: out };
}
