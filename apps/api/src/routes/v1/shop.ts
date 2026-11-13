/**
 * Vitrine do Shopping (#921, épico #909) — módulo shopping:
 *
 *   GET /v1/shop/{kind}/{id}?country=BR[&event=<uuid>][&origin=site|app][&lang=pt-BR]
 *
 * Os produtos oficiais da entidade (time, seleção, campeonato, atleta, piloto) por loja ligada, com a oferta da loja
 * (#916). O botão "Comprar" passa pela rota de cliques (`/go/shop/<id>`, #918), que monta o link de afiliado.
 *
 * Destino: o código de afiliado da Galaxie só vale para os tenants da própria Galaxie (site e app), listados em
 * `SHOP_GALAXIE_TENANT_IDS`. Para qualquer outro tenant a lista vem vazia até o widget do Builder (#925) trazer a
 * matriz e o código de cada cliente: nenhum caminho daqui leva o código da Galaxie a um domínio de cliente.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ShopParams,
  ShopQuery,
  WidgetShopParams,
  WidgetShopQuery,
  type ShopEntity,
} from '@galaxie/contracts';
import { getWidget, type Widget } from '@galaxie/db';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import type { ShopClickSigner } from '../../shop/click-token.js';
import type { ShopOffers } from '../../shop/offers.js';
import { widgetShopDestinations, widgetStoreOrder } from '../../shop/widget.js';
import { parseInput } from '../../util.js';

const MODULE = { module: 'shopping' } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenants da Galaxie (site e app): os únicos que recebem o código de afiliado da Galaxie. */
export function galaxieShopTenants(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => UUID.test(s)),
  );
}

export interface ShopRoutesOptions {
  offers: ShopOffers | undefined;
  /** Endereço público da API (o botão aponta para a rota de cliques dela). */
  publicUrl: string | undefined;
  galaxieTenants: Set<string>;
  /** Assina o link de compra: a rota de cliques só põe o código da Galaxie em link assinado. */
  signer: ShopClickSigner;
  now: () => Date;
}

const tenantIdOf = (r: FastifyRequest) =>
  (r as FastifyRequest & { tenant?: { tenantId: string } }).tenant?.tenantId?.toLowerCase();

export async function shopRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  opts: ShopRoutesOptions,
): Promise<void> {
  const base = (opts.publicUrl ?? '').replace(/\/+$/, '');

  app.get('/v1/shop/:kind/:id', { config: MODULE }, async (request, reply) => {
    requireDb(ctx);
    if (!opts.offers) throw problems.degraded('Shopping indisponível: banco de dados não configurado.');
    const p = parseInput(ShopParams, request.params);
    const q = parseInput(ShopQuery, request.query);
    reply.header('cache-control', 'private, max-age=60');
    const empty: ShopEntity = { entity: { kind: p.kind, id: p.id }, stores: [], disclosure: 'affiliate' };
    const tenant = tenantIdOf(request);
    // fora dos tenants da Galaxie, nada de código da Galaxie: o widget do cliente vem no #925
    if (!tenant || !opts.galaxieTenants.has(tenant)) return empty;

    const stores = await opts.offers.entityOffers(
      { kind: p.kind, id: p.id },
      { kind: 'galaxie' },
      {
        country: q.country,
      },
    );
    if (!stores) throw problems.notFound('Cadastro no Shopping');
    const click = (productId: string) => {
      const u = new URL(`${base || 'http://localhost'}/go/shop/${productId}`);
      u.searchParams.set('origin', q.origin);
      const t = opts.signer.sign(productId, q.origin, opts.now());
      if (t) u.searchParams.set('t', t);
      if (q.event) u.searchParams.set('event', q.event);
      if (q.lang) u.searchParams.set('lang', q.lang);
      return base ? u.toString() : `${u.pathname}${u.search}`;
    };
    const body: ShopEntity = {
      entity: { kind: p.kind, id: p.id },
      stores: stores.map((s) => ({
        store: { id: s.store.id, name: s.store.name, country: s.store.country },
        products: s.products.map((o) => ({
          id: o.id,
          product_type: o.productType,
          title: o.title,
          season: o.season,
          price: o.price,
          currency: o.currency,
          image_url: o.imageUrl,
          fetched_at: o.fetchedAt,
          source: o.source,
          buy_url: click(o.id),
        })),
      })),
      disclosure: 'affiliate',
    };
    return body;
  });

  // ─── widget do cliente (#925) ─────────────────────────────────────────────────────────────────
  const widgets = new Map<string, { value: Widget | null; at: number }>();
  const widgetOf = async (id: string): Promise<Widget | null> => {
    const hit = widgets.get(id);
    const t = opts.now().getTime();
    if (hit && t - hit.at < 60_000) return hit.value;
    const value = await getWidget(requireDb(ctx), id);
    if (widgets.size > 10_000) widgets.clear();
    widgets.set(id, { value, at: t });
    return value;
  };

  app.get('/v1/widgets/:id/shop', { config: MODULE }, async (request, reply) => {
    requireDb(ctx);
    if (!opts.offers) throw problems.degraded('Shopping indisponível: banco de dados não configurado.');
    const p = parseInput(WidgetShopParams, request.params);
    const q = parseInput(WidgetShopQuery, request.query);
    const tenant = (request as FastifyRequest & { tenant?: { tenantId: string; widgetId?: string | null } })
      .tenant;
    if (!tenant) throw problems.invalidKey();
    // chave publicável presa a outro widget: o widget não existe para ela
    if (tenant.widgetId && tenant.widgetId !== p.id) throw problems.notFound('Widget');
    const widget = await widgetOf(p.id);
    if (
      !widget ||
      widget.tenantId !== tenant.tenantId ||
      widget.archivedAt ||
      widget.kind !== 'shop_the_game'
    )
      throw problems.notFound('Widget');
    reply.header('cache-control', 'private, max-age=60');
    const empty: ShopEntity = { entity: { kind: q.kind, id: q.entity }, stores: [], disclosure: 'affiliate' };

    const connectors = await opts.offers.storeConnectors();
    const dests = widgetShopDestinations(widget.tenantId, widget.config.shop, connectors);
    if (!dests.size) return empty;
    const stores = await opts.offers.entityOffers(
      { kind: q.kind, id: q.entity },
      (storeId) => dests.get(storeId)?.dest ?? null,
      { country: widget.config.market },
    );
    if (!stores) return empty;
    const order = widgetStoreOrder(widget.config.shop);
    const origin = `client:${widget.id}`;
    const click = (productId: string) => {
      const u = new URL(`${base || 'http://localhost'}/go/shop/${productId}`);
      u.searchParams.set('origin', 'client');
      u.searchParams.set('w', widget.id);
      const t = opts.signer.sign(productId, origin, opts.now());
      if (t) u.searchParams.set('t', t);
      if (q.event) u.searchParams.set('event', q.event);
      if (q.lang) u.searchParams.set('lang', q.lang);
      return base ? u.toString() : `${u.pathname}${u.search}`;
    };
    const body: ShopEntity = {
      entity: { kind: q.kind, id: q.entity },
      stores: stores
        .sort((a, b) => (order.get(a.store.id) ?? 999) - (order.get(b.store.id) ?? 999))
        .map((s) => ({
          store: { id: s.store.id, name: s.store.name, country: s.store.country },
          display: dests.get(s.store.id)?.qrOnly ? ('qr' as const) : ('link' as const),
          products: s.products.map((o) => ({
            id: o.id,
            product_type: o.productType,
            title: o.title,
            season: o.season,
            price: o.price,
            currency: o.currency,
            image_url: o.imageUrl,
            fetched_at: o.fetchedAt,
            source: o.source,
            buy_url: click(o.id),
          })),
        })),
      disclosure: 'affiliate',
    };
    return body;
  });
}
