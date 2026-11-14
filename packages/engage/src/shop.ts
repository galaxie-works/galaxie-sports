/**
 * Conectores de loja do Shopping (#916, épico #909), sem banco nem HTTP próprio: dado um produto âncora (#914), o link
 * de afiliado certo para o destino e a oferta (título, preço, disponibilidade, imagem) que a loja devolve pela
 * ferramenta oficial dela. O widget e as páginas falam só com esta camada; trocar ou desligar uma loja não mexe neles.
 *
 * Regras que esta camada garante (épico #909):
 * - o código de afiliado da Galaxie só vai para destino Galaxie (site e app). Para o cliente, só o caminho que a
 *   matriz da loja libera: repasse pela Galaxie (sub-rede, com clickref do cliente) ou o código do próprio cliente.
 *   Sem caminho liberado, não há link;
 * - produto, imagem e link só da ferramenta oficial: nada de raspar página. Imagem é a URL devolvida pela loja,
 *   nunca baixada;
 * - preço com cache de no máximo 24 h e a data e hora da consulta junto;
 * - sem estoque, o produto não aparece.
 */

export const SHOP_CLIENT_PATHS = ['client_code', 'subnetwork'] as const;
/** Caminho para o widget do cliente: repasse pela Galaxie (sub-rede) ou código de afiliado do próprio cliente. */
export type ShopClientPath = (typeof SHOP_CLIENT_PATHS)[number];

/** Redes em que a sub-rede existe (repasse com clickref por cliente). Amazon e Mercado Livre não permitem. */
export const SUBNETWORK_NETWORKS = ['awin', 'impact', 'direct'] as const;

/** Redes cujo link sai de um modelo entregue pelo programa (`linkTemplate`). */
export const TEMPLATE_NETWORKS = ['impact', 'direct'] as const;

/**
 * Parâmetros de rastreio de afiliado que podem ter vindo colados no link curado: saem antes de montar o link, para o
 * código de uma conta nunca vazar para o link de outra.
 */
export const AFFILIATE_PARAMS = [
  'ascsubtag',
  'awinaffid',
  'awinmid',
  'camp',
  'clickref',
  'creative',
  'creativeasin',
  'irclickid',
  'irgwc',
  'irpid',
  'linkcode',
  'linkid',
  'matt_tool',
  'matt_word',
  'sharedid',
  'subid1',
  'subid2',
  'subid3',
  'tag',
] as const;

export function stripAffiliateParams(url: URL): URL {
  const out = new URL(url.toString());
  for (const k of [...out.searchParams.keys()])
    if ((AFFILIATE_PARAMS as readonly string[]).includes(k.toLowerCase())) out.searchParams.delete(k);
  return out;
}

export type ShopNetworkName = 'amazon' | 'awin' | 'direct' | 'impact' | 'mercado_livre';

/**
 * Chave do cofre do painel (AAD) das credenciais de uma loja, gravadas em `engage.shop_store.credentials_sealed`: o
 * cifrado de uma loja não abre em outra.
 */
export const shopStoreSecretKey = (storeId: string) => `SHOP_STORE_${storeId.toUpperCase()}`;

/** Teto do cache de preço (regra do épico): a configuração pode baixar, nunca subir. */
export const SHOP_PRICE_CACHE_MAX_HOURS = 24;

/** Destino do link: o site ou app Galaxie, ou o widget de um cliente com o caminho escolhido para a loja. */
export type ShopDestination =
  | { kind: 'galaxie' }
  | {
      kind: 'client';
      tenantId: string;
      path: ShopClientPath;
      /** Sub-rede: identificador do cliente na rede (clickref). */
      clickref?: string | null;
      /** Código do cliente: o código de rastreio dele naquela loja. */
      clientCode?: string | null;
    };

/** Credenciais da conta da Galaxie na loja (gravadas cifradas; ver `ShopStoreConnector`). */
export interface ShopCredentials {
  /** Código de afiliado da Galaxie (tag da Amazon, `matt_word` do Mercado Livre, id de publisher da Awin…). */
  affiliateId?: string;
  /** Segundo campo do programa (`matt_tool` do Mercado Livre, id do site na Impact). */
  affiliateTool?: string;
  /** Token da API da rede, quando o programa libera consulta de catálogo. */
  apiToken?: string;
  apiSecret?: string;
}

/** Configuração não secreta da loja na rede (ex.: id do anunciante na Awin, domínio da Amazon). */
export interface ShopStoreConfig {
  /** Awin: id do anunciante (awinmid). */
  advertiserId?: string;
  /** Impact e contrato direto: modelo https do link de rastreio do programa, com `{url}`, `{code}` e `{clickref}`. */
  linkTemplate?: string;
}

/** O que o conector precisa da loja: rede, matriz de caminhos, configuração e credenciais já abertas. */
export interface ShopStoreConnector {
  id: string;
  network: ShopNetworkName;
  active: boolean;
  /** Matriz loja × caminho (#916): o que o widget do cliente pode usar nesta loja. */
  clientPaths: readonly ShopClientPath[];
  config: ShopStoreConfig;
  credentials: ShopCredentials | null;
}

export interface ShopProductRef {
  id: string;
  storeProductId: string;
  title: string;
  /** Link oficial do produto, sem código de afiliado (#914). */
  url: string;
}

export interface ShopOffer {
  productId: string;
  title: string;
  /** Preço em unidades da moeda (null no modo link curado). */
  price: number | null;
  currency: string | null;
  available: boolean;
  /** URL da imagem devolvida pela loja (nunca baixada). */
  imageUrl: string | null;
  /** Quando a loja foi consultada (ISO); vai ao lado do preço. Null no modo link curado. */
  fetchedAt: string | null;
  /** `curated`: link curado, sem preço; `live`: veio da API da loja. */
  source: 'curated' | 'live';
}

export type ShopLinkRefusal =
  'store_off' | 'path_not_allowed' | 'missing_code' | 'missing_credentials' | 'bad_url';

export type ShopLinkResult = { ok: true; url: string } | { ok: false; reason: ShopLinkRefusal };

const TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;
const isToken = (v: unknown): v is string => typeof v === 'string' && TOKEN.test(v);

function parseHttps(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null;
  } catch {
    return null;
  }
}

/**
 * Qual código vai no link: o da Galaxie (destino Galaxie, ou sub-rede liberada, com o clickref do cliente) ou o do
 * cliente (código próprio liberado). Nunca o da Galaxie no caminho do código do cliente.
 */
export function resolveAffiliateCode(
  store: ShopStoreConnector,
  dest: ShopDestination,
): { ok: true; code: string; tool?: string; clickref?: string } | { ok: false; reason: ShopLinkRefusal } {
  if (!store.active) return { ok: false, reason: 'store_off' };
  if (dest.kind === 'galaxie') {
    const code = store.credentials?.affiliateId;
    if (!isToken(code)) return { ok: false, reason: 'missing_credentials' };
    const tool = store.credentials?.affiliateTool;
    return { ok: true, code, ...(isToken(tool) ? { tool } : {}) };
  }
  if (!store.clientPaths.includes(dest.path)) return { ok: false, reason: 'path_not_allowed' };
  if (dest.path === 'client_code') {
    // o modelo do link (Impact, contrato direto) é da conta da Galaxie: o código do cliente não cabe nele
    if ((TEMPLATE_NETWORKS as readonly string[]).includes(store.network))
      return { ok: false, reason: 'path_not_allowed' };
    if (!isToken(dest.clientCode)) return { ok: false, reason: 'missing_code' };
    return { ok: true, code: dest.clientCode };
  }
  // sub-rede: só nas redes que têm repasse, com o clickref do cliente para conciliar
  if (!(SUBNETWORK_NETWORKS as readonly string[]).includes(store.network))
    return { ok: false, reason: 'path_not_allowed' };
  const code = store.credentials?.affiliateId;
  if (!isToken(code)) return { ok: false, reason: 'missing_credentials' };
  if (!isToken(dest.clickref)) return { ok: false, reason: 'missing_code' };
  return { ok: true, code, clickref: dest.clickref };
}

/**
 * Link de afiliado do produto para o destino, montado do jeito que cada programa documenta:
 * - Amazon: parâmetro `tag` no link do produto;
 * - Mercado Livre: `matt_word` (código) e `matt_tool` no link do produto (confirmar no cadastro, #911);
 * - Awin: deeplink `awin1.com/cread.php` com `awinmid`, `awinaffid`, `clickref` e o link do produto em `ued`;
 * - Impact e contrato direto: o modelo do link de rastreio que o programa entrega (`linkTemplate`, com `{url}`,
 *   `{code}` e `{clickref}`).
 */
export function buildAffiliateLink(
  store: ShopStoreConnector,
  product: Pick<ShopProductRef, 'url'>,
  dest: ShopDestination,
): ShopLinkResult {
  const parsed = parseHttps(product.url);
  if (!parsed) return { ok: false, reason: 'bad_url' };
  const target = stripAffiliateParams(parsed);
  const r = resolveAffiliateCode(store, dest);
  if (!r.ok) return r;
  switch (store.network) {
    case 'amazon': {
      target.searchParams.set('tag', r.code);
      return { ok: true, url: target.toString() };
    }
    case 'mercado_livre': {
      target.searchParams.set('matt_word', r.code);
      if (r.tool) target.searchParams.set('matt_tool', r.tool);
      return { ok: true, url: target.toString() };
    }
    case 'awin': {
      const mid = store.config.advertiserId;
      if (!isToken(mid)) return { ok: false, reason: 'missing_credentials' };
      const link = new URL('https://www.awin1.com/cread.php');
      link.searchParams.set('awinmid', mid);
      link.searchParams.set('awinaffid', r.code);
      if (r.clickref) link.searchParams.set('clickref', r.clickref);
      link.searchParams.set('ued', target.toString());
      return { ok: true, url: link.toString() };
    }
    case 'impact':
    case 'direct': {
      // o programa entrega o modelo do link de rastreio; aqui só se preenche
      const tpl = store.config.linkTemplate;
      if (!validLinkTemplate(tpl)) return { ok: false, reason: 'missing_credentials' };
      // sub-rede sem lugar para o clickref do cliente: a comissão não teria como ser conciliada
      if (r.clickref && !tpl.includes('{clickref}')) return { ok: false, reason: 'missing_code' };
      const url = tpl
        .replaceAll('{code}', encodeURIComponent(r.code))
        .replaceAll('{clickref}', encodeURIComponent(r.clickref ?? ''))
        .replaceAll('{url}', encodeURIComponent(target.toString()));
      return parseHttps(url) ? { ok: true, url } : { ok: false, reason: 'bad_url' };
    }
  }
}

/** Modelo do link de rastreio: https, com `{url}` e `{code}` (o código vem sempre daqui, nunca fixo no modelo). */
export function validLinkTemplate(tpl: string | undefined): tpl is string {
  return (
    !!tpl && tpl.includes('{url}') && tpl.includes('{code}') && !!parseHttps(tpl.replace(/\{[a-z]+\}/g, 'x'))
  );
}

/** Horas do cache de preço: a configurada, dentro de 1 a 24 (o teto do épico). */
export function priceCacheHours(configured: unknown): number {
  const n = Number(configured);
  if (!Number.isFinite(n) || n <= 0) return SHOP_PRICE_CACHE_MAX_HOURS;
  return Math.min(SHOP_PRICE_CACHE_MAX_HOURS, Math.max(1, Math.floor(n)));
}

/** A oferta consultada ainda vale (dentro do cache). Sem data de consulta, não vale. */
export function offerFresh(offer: Pick<ShopOffer, 'fetchedAt'>, now: Date, hours: number): boolean {
  if (!offer.fetchedAt) return false;
  const at = Date.parse(offer.fetchedAt);
  return (
    Number.isFinite(at) && at <= now.getTime() && now.getTime() - at < priceCacheHours(hours) * 3_600_000
  );
}

/** O que pode aparecer para o torcedor: disponível e, se veio da loja, com preço. Sem estoque, some. */
export function visibleOffers<T extends ShopOffer>(offers: readonly T[]): T[] {
  return offers.filter((o) => o.available && (o.source === 'curated' || o.price !== null));
}

/** Um conector de loja: dado o lote de produtos de uma loja, as ofertas (pode devolver menos, nunca inventa). */
export interface ShopConnector {
  readonly mode: 'curated' | 'live';
  offers(store: ShopStoreConnector, products: readonly ShopProductRef[], now: Date): Promise<ShopOffer[]>;
}

/** Modo link curado: o nome curado e o link oficial, sem preço nem imagem (ex.: Amazon antes da API liberada). */
export const curatedConnector: ShopConnector = {
  mode: 'curated',
  async offers(_store, products) {
    return products.map((p) => ({
      productId: p.id,
      title: p.title,
      price: null,
      currency: null,
      available: true,
      imageUrl: null,
      fetchedAt: null,
      source: 'curated' as const,
    }));
  },
};

export type ShopFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface MeliItem {
  id?: string;
  title?: string;
  price?: number;
  currency_id?: string;
  available_quantity?: number;
  status?: string;
  pictures?: Array<{ secure_url?: string }>;
  secure_thumbnail?: string;
}

const MELI_ID = /^ML[A-Z]\d{1,15}$/;

/**
 * Mercado Livre pela API oficial (`/items?ids=`), com o token da conta da Galaxie. Só o que a API devolve; produto
 * pausado, encerrado ou sem estoque volta como indisponível. Sem token, cai no modo link curado.
 */
export function mercadoLivreConnector(
  fetchFn: ShopFetch,
  opts: { baseUrl?: string; timeoutMs?: number } = {},
): ShopConnector {
  const base = opts.baseUrl ?? 'https://api.mercadolibre.com';
  return {
    mode: 'live',
    async offers(store, products, now) {
      const token = store.credentials?.apiToken;
      if (!token) return curatedConnector.offers(store, products, now);
      const ids = products.map((p) => p.storeProductId.toUpperCase()).filter((id) => MELI_ID.test(id));
      const out: ShopOffer[] = [];
      const failures: number[] = [];
      // a API aceita até 20 ids por chamada
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        const url = `${base}/items?ids=${chunk.join(',')}&attributes=id,title,price,currency_id,available_quantity,status,pictures,secure_thumbnail`;
        const res = await fetchFn(url, {
          headers: { authorization: `Bearer ${token}`, 'user-agent': 'galaxie-sports/0.1' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
        });
        if (!res.ok) {
          // token vencido (o do Mercado Livre é OAuth) ou loja fora: este lote fica no link curado
          failures.push(res.status);
          const ids = new Set(chunk);
          out.push(
            ...(await curatedConnector.offers(
              store,
              products.filter((p) => ids.has(p.storeProductId.toUpperCase())),
              now,
            )),
          );
          continue;
        }
        const body = (await res.json()) as Array<{ code?: number; body?: MeliItem }>;
        for (const entry of Array.isArray(body) ? body : []) {
          const item = entry?.body;
          if (entry?.code !== 200 || !item?.id) continue;
          const product = products.find((p) => p.storeProductId.toUpperCase() === item.id);
          if (!product) continue;
          const image = item.pictures?.[0]?.secure_url ?? item.secure_thumbnail ?? null;
          out.push({
            productId: product.id,
            title: typeof item.title === 'string' && item.title ? item.title : product.title,
            price: typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null,
            currency: typeof item.currency_id === 'string' ? item.currency_id : null,
            available: item.status === 'active' && (item.available_quantity ?? 0) > 0,
            imageUrl: image && image.startsWith('https://') ? image : null,
            fetchedAt: now.toISOString(),
            source: 'live',
          });
        }
      }
      if (failures.length && !out.some((o) => o.source === 'live'))
        throw new ShopConnectorError(`mercado livre: HTTP ${failures.join(', ')}`, out);
      return out;
    },
  };
}

/** A loja falhou; `fallback` traz o que dá para mostrar mesmo assim (link curado). */
export class ShopConnectorError extends Error {
  constructor(
    message: string,
    readonly fallback: ShopOffer[] = [],
  ) {
    super(message);
    this.name = 'ShopConnectorError';
  }
}

/**
 * O conector de cada rede. Amazon (Creators API), Awin (feed de produtos) e Impact entram em modo link curado até a
 * conta de cada programa liberar a consulta de catálogo (#911); o Mercado Livre consulta a API quando há token.
 */
export function connectorFor(network: ShopNetworkName, fetchFn: ShopFetch): ShopConnector {
  return network === 'mercado_livre' ? mercadoLivreConnector(fetchFn) : curatedConnector;
}
