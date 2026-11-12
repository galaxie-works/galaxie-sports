/**
 * Ofertas do Shopping (#916): para uma entidade (#914) e um destino, os produtos âncora de cada loja ligada com a oferta
 * da loja (preço, estoque, imagem) e o link de afiliado certo. Junta o catálogo (`@galaxie/db`), as credenciais da
 * loja (cifradas no banco, abertas aqui com a `SETTINGS_KEK`) e os conectores (`@galaxie/engage`).
 *
 * - Cache por produto no Redis (ou na memória, sem Redis), com no máximo `SHOP_PRICE_CACHE_HOURS` horas (teto de 24);
 * - loja com erro não derruba as outras: os produtos dela ficam de fora nesta resposta, e a métrica conta o erro;
 * - produto sem estoque ou sem link para o destino não aparece; sem nada, a loja some.
 */
import type { Redis } from 'ioredis';
import {
  listShopStoreConnectorRows,
  shopAnchors,
  type Database,
  type ShopEntityKind,
  type ShopStoreConnectorRow,
} from '@galaxie/db';
import {
  SHOP_CLIENT_PATHS,
  buildAffiliateLink,
  ShopConnectorError,
  connectorFor,
  curatedConnector,
  offerFresh,
  priceCacheHours,
  shopStoreSecretKey,
  visibleOffers,
  type ShopClientPath,
  type ShopCredentials,
  type ShopDestination,
  type ShopFetch,
  type ShopNetworkName,
  type ShopOffer,
  type ShopStoreConnector,
} from '@galaxie/engage';
import type { GalaxieMetrics } from '@galaxie/observability';
import { settingsSecretBox, type SettingsSecretBox } from '@galaxie/runtime-config/sealed';

export { shopStoreSecretKey };

const CRED_FIELDS = ['affiliateId', 'affiliateTool', 'apiToken', 'apiSecret'] as const;

/** Abre e confere o JSON das credenciais; o que não for texto curto sai. */
export function openShopCredentials(
  box: Pick<SettingsSecretBox, 'open'>,
  storeId: string,
  sealed: string | null,
): ShopCredentials | null {
  if (!sealed) return null;
  const raw = box.open(shopStoreSecretKey(storeId), sealed);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: ShopCredentials = {};
    for (const k of CRED_FIELDS) {
      const v = parsed[k];
      if (typeof v === 'string' && v.length > 0 && v.length <= 2000) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export function toConnector(
  row: ShopStoreConnectorRow,
  box: Pick<SettingsSecretBox, 'open'>,
): ShopStoreConnector {
  return {
    id: row.id,
    network: row.network as ShopNetworkName,
    active: row.active,
    clientPaths: row.clientPaths.filter((p): p is ShopClientPath =>
      (SHOP_CLIENT_PATHS as readonly string[]).includes(p),
    ),
    config: {
      ...(typeof row.config?.advertiserId === 'string' ? { advertiserId: row.config.advertiserId } : {}),
      ...(typeof row.config?.linkTemplate === 'string' ? { linkTemplate: row.config.linkTemplate } : {}),
    },
    credentials: openShopCredentials(box, row.id, row.credentialsSealed),
  };
}

export interface ShopOfferItem {
  id: string;
  productType: string;
  season: string | null;
  title: string;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  fetchedAt: string | null;
  source: ShopOffer['source'];
  link: string;
}

export interface ShopStoreOffers {
  store: { id: string; name: string; country: string; network: string };
  products: ShopOfferItem[];
}

export interface ShopOffersOptions {
  db: Database;
  redis?: Redis | null;
  keyPrefix?: string;
  metrics?: GalaxieMetrics | undefined;
  log?: { warn(obj: object, msg: string): void };
  fetch?: ShopFetch;
  now?: () => Date;
  /** Horas do cache de preço (`SHOP_PRICE_CACHE_HOURS`); teto de 24. */
  cacheHours?: number;
  box?: Pick<SettingsSecretBox, 'open'>;
}

/** Ofertas guardadas na memória quando não há Redis. */
const MEMORY_MAX = 5_000;

/** Lojas relidas do banco no máximo a cada minuto (liga/desliga e credenciais da tela valem sem deploy). */
const STORES_TTL_MS = 60_000;

export class ShopOffers {
  private stores: { at: number; list: ShopStoreConnector[] } | null = null;
  private readonly memory = new Map<string, { until: number; offer: ShopOffer }>();
  private readonly hours: number;

  constructor(private readonly opts: ShopOffersOptions) {
    this.hours = priceCacheHours(opts.cacheHours ?? process.env.SHOP_PRICE_CACHE_HOURS);
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private async storeConnectors(): Promise<Map<string, ShopStoreConnector>> {
    const t = this.now().getTime();
    if (!this.stores || t - this.stores.at > STORES_TTL_MS) {
      const box = this.opts.box ?? settingsSecretBox();
      const rows = await listShopStoreConnectorRows(this.opts.db);
      this.stores = { at: t, list: rows.map((r) => toConnector(r, box)) };
    }
    return new Map(this.stores.list.map((s) => [s.id, s]));
  }

  /**
   * A chave leva a rede e o modo do conector: trocar a rede da loja ou ligar a API dela não fica servindo a oferta
   * da configuração anterior.
   */
  private cacheKey(mode: string, storeId: string, productId: string) {
    return `${this.opts.keyPrefix ?? ''}shop:offer:${mode}:${storeId}:${productId}`;
  }

  private async cached(mode: string, storeId: string, productId: string): Promise<ShopOffer | null> {
    const key = this.cacheKey(mode, storeId, productId);
    let offer: ShopOffer | null;
    if (this.opts.redis) {
      const raw = await this.opts.redis.get(key).catch(() => null);
      try {
        offer = raw ? (JSON.parse(raw) as ShopOffer) : null;
      } catch {
        // chave corrompida ou de formato antigo: vale como ausente
        offer = null;
      }
    } else {
      const hit = this.memory.get(key);
      offer = hit && hit.until > this.now().getTime() ? hit.offer : null;
    }
    // o cache nunca serve além do teto, mesmo que a chave tenha sobrado de uma configuração maior
    return offer && (offer.source === 'curated' || offerFresh(offer, this.now(), this.hours)) ? offer : null;
  }

  private async remember(mode: string, storeId: string, offer: ShopOffer): Promise<void> {
    const key = this.cacheKey(mode, storeId, offer.productId);
    const seconds = this.hours * 3600;
    if (this.opts.redis) await this.opts.redis.set(key, JSON.stringify(offer), 'EX', seconds).catch(() => {});
    else {
      // sem Redis (dev, testes): a memória não cresce sem fim; as vencidas saem primeiro
      if (this.memory.size >= MEMORY_MAX) {
        const t = this.now().getTime();
        for (const [k, v] of this.memory) if (v.until <= t) this.memory.delete(k);
        if (this.memory.size >= MEMORY_MAX) this.memory.clear();
      }
      this.memory.set(key, { until: this.now().getTime() + seconds * 1000, offer });
    }
  }

  /** Ofertas da entidade para o destino, por loja ligada (ordem do catálogo). Entidade sem cadastro: null. */
  async entityOffers(
    ref: { kind: ShopEntityKind; id: string },
    dest: ShopDestination,
    opts: { country?: string | undefined } = {},
  ): Promise<ShopStoreOffers[] | null> {
    const anchors = await shopAnchors(this.opts.db, ref, { country: opts.country });
    if (!anchors) return null;
    const stores = await this.storeConnectors();
    const fetchFn = this.opts.fetch ?? (globalThis.fetch as unknown as ShopFetch);
    const out: ShopStoreOffers[] = [];
    for (const group of anchors.stores) {
      const store = stores.get(group.store.id);
      if (!store?.active) continue;
      // sem link para o destino, nem consulta a loja
      const linked = group.products
        .map((p) => ({ p, link: buildAffiliateLink(store, p, dest) }))
        .filter((x): x is typeof x & { link: { ok: true; url: string } } => x.link.ok);
      if (!linked.length) continue;

      const connector = connectorFor(store.network, fetchFn);
      const offers = new Map<string, ShopOffer>();
      const missing = [];
      for (const { p } of linked) {
        const hit = await this.cached(`${store.network}.${connector.mode}`, store.id, p.id);
        if (hit) offers.set(p.id, hit);
        else missing.push(p);
      }
      // uma por produto servido do cache (a proporção cache × loja fica certa)
      if (offers.size)
        this.opts.metrics?.shopConnectorRequests.inc({ store: store.id, outcome: 'cache' }, offers.size);
      if (missing.length) {
        const stop = this.opts.metrics?.shopConnectorDuration.startTimer({ store: store.id });
        try {
          const fresh = await connector.offers(store, missing, this.now());
          stop?.();
          this.opts.metrics?.shopConnectorRequests.inc({ store: store.id, outcome: 'ok' });
          for (const o of fresh) {
            offers.set(o.productId, o);
            await this.remember(`${store.network}.${connector.mode}`, store.id, o);
          }
        } catch (err) {
          stop?.();
          this.opts.metrics?.shopConnectorRequests.inc({ store: store.id, outcome: 'error' });
          // a loja falhou: os produtos dela ficam no link curado (sem preço), sem ir para o cache
          this.opts.log?.warn(
            { store: store.id, err: err instanceof Error ? err.message : 'erro' },
            'shop: conector falhou; link curado',
          );
          const fallback =
            err instanceof ShopConnectorError && err.fallback.length
              ? err.fallback
              : await curatedConnector.offers(store, missing, this.now());
          for (const o of fallback) offers.set(o.productId, o);
        }
      }

      const visible = new Set(visibleOffers([...offers.values()]).map((o) => o.productId));
      const products: ShopOfferItem[] = [];
      for (const { p, link } of linked) {
        const o = offers.get(p.id);
        if (!o || !visible.has(p.id)) continue;
        products.push({
          id: p.id,
          productType: p.productType,
          season: p.season,
          title: o.title,
          price: o.price,
          currency: o.currency,
          imageUrl: o.imageUrl,
          fetchedAt: o.fetchedAt,
          source: o.source,
          link: link.url,
        });
      }
      if (products.length)
        out.push({
          store: {
            id: store.id,
            name: group.store.name,
            country: group.store.country,
            network: store.network,
          },
          products,
        });
    }
    return out;
  }
}
