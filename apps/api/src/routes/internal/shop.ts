/**
 * Rotas internas do Shopping (#914, épico #909) — chave administrativa (x-galaxie-admin-key) e x-galaxie-actor.
 *
 *   GET /internal/shop/stores[?country=BR]                                 lojas da Galaxie, por país e ordem
 *   GET /internal/shop/entities/:kind/:id/anchors[?store=…][&country=BR]   âncoras da entidade, por loja
 *
 * `kind` é de onde vem a entidade: `participant` (time, seleção, atleta, piloto), `competition` ou `person`. Só
 * produto aprovado e ativo; sem imagem nem preço (vêm do conector da loja, #916). Nada aqui leva código de
 * afiliado: o link é o oficial da loja, e a tag entra no conector conforme o destino.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod';
import { listShopStores, SHOP_ENTITY_KINDS, shopAnchors, type ShopStoreRow } from '@galaxie/db';
import { assertAdmin } from '../../auth/admin-key.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { parseInput } from '../../util.js';

/** Rotas internas: protegidas pelo AdminGuard (auditoria de segurança verifica `config.admin`). */
const ADMIN_ROUTE = { admin: true } as const;

const Country = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .transform((s) => s.toUpperCase());
const StoresQuery = z.object({ country: Country.optional() });
const AnchorsParams = z.object({ kind: z.enum(SHOP_ENTITY_KINDS), id: z.uuid() });
const AnchorsQuery = z.object({
  store: z
    .string()
    .regex(/^[a-z0-9_]{2,40}$/)
    .optional(),
  country: Country.optional(),
});

const storeBody = (s: ShopStoreRow) => ({
  id: s.id,
  name: s.name,
  country: s.country,
  network: s.network,
  home_url: s.homeUrl,
  active: s.active,
  position: s.position,
});

const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');

export async function internalShopRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(async (internal) => {
    internal.addHook('onRequest', async (request: FastifyRequest) => {
      assertAdmin(request, ctx.adminGuard);
    });

    internal.get('/internal/shop/stores', { config: ADMIN_ROUTE }, async (request, reply) => {
      const db = requireDb(ctx);
      const q = parseInput(StoresQuery, request.query);
      noStore(reply);
      return { data: (await listShopStores(db, { country: q.country })).map(storeBody) };
    });

    internal.get(
      '/internal/shop/entities/:kind/:id/anchors',
      { config: ADMIN_ROUTE },
      async (request, reply) => {
        const db = requireDb(ctx);
        const p = parseInput(AnchorsParams, request.params);
        const q = parseInput(AnchorsQuery, request.query);
        const r = await shopAnchors(db, { kind: p.kind, id: p.id }, { store: q.store, country: q.country });
        if (!r) throw problems.notFound('Cadastro no Shopping');
        noStore(reply);
        return {
          data: {
            entity: {
              kind: r.entity.kind,
              id: r.entity.id,
              kit_brand: r.entity.kitBrand,
              kit_season: r.entity.kitSeason,
              reviewed_season: r.entity.reviewedSeason,
            },
            stores: r.stores.map((s) => ({
              store: storeBody(s.store),
              lookup: s.lookup
                ? { kind: s.lookup.kind, value: s.lookup.value, page_url: s.lookup.pageUrl }
                : null,
              products: s.products.map((a) => ({
                id: a.id,
                store_product_id: a.storeProductId,
                product_type: a.productType,
                title: a.title,
                season: a.season,
                url: a.url,
                position: a.position,
              })),
            })),
          },
        };
      },
    );
  });
}
