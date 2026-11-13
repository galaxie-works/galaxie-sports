import 'zod-openapi';
import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { getOp } from './openapi-ops.js';

// ─── Shopping: produtos oficiais das entidades da página (épico #909, vitrine #921) ─────────────────

/** De onde vem a entidade: `participant` (time, seleção, atleta, piloto), `competition` ou `person`. */
export const SHOP_ENTITY_KINDS = ['competition', 'participant', 'person'] as const;

export const ShopParams = z.object({
  kind: z.enum(SHOP_ENTITY_KINDS),
  id: z.uuid(),
});

export const ShopQuery = z.object({
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .optional()
    .meta({ description: 'País das lojas (ISO alfa-2). Sem ele, todas as lojas ligadas.' }),
  event: z
    .uuid()
    .optional()
    .meta({ description: 'Jogo da página: vai no link de compra para medir o clique.' }),
  origin: z
    .enum(['site', 'app'])
    .default('site')
    .meta({ description: 'Onde o botão aparece (site ou app).' }),
  lang: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Z]{2}|-\d{3})?$/)
    .optional()
    .meta({ description: 'Idioma da página: vai no link de compra para o relatório de cliques.' }),
});

const ShopProduct = z.object({
  id: z.uuid(),
  product_type: z.string().meta({ description: 'home_kit, away_kit, cap, mug, commemorative, champion…' }),
  title: z.string(),
  season: z.string().nullable(),
  price: z.number().nullable().meta({ description: 'null no modo link curado (a loja não informa preço).' }),
  currency: z.string().nullable(),
  image_url: z.string().nullable().meta({ description: 'Imagem servida pela própria loja (nunca copiada).' }),
  fetched_at: z.string().nullable().meta({
    description: 'Quando a loja foi consultada; mostrar ao lado do preço (cache de no máximo 24 h).',
  }),
  source: z.enum(['curated', 'live']),
  buy_url: z.string().meta({
    description: 'Link do botão "Comprar": passa pelo registro de cliques e abre a loja fora do app.',
  }),
});

export const ShopEntity = z.object({
  entity: z.object({ kind: z.enum(SHOP_ENTITY_KINDS), id: z.uuid() }),
  stores: z.array(
    z.object({
      store: z.object({ id: z.string(), name: z.string(), country: z.string() }),
      display: z
        .enum(['link', 'qr'])
        .optional()
        .meta({ description: 'Widget do cliente: `qr` em TV (só o QR code da loja, sem botão).' }),
      products: z.array(ShopProduct),
    }),
  ),
  disclosure: z
    .literal('affiliate')
    .meta({ description: 'Os links são de parceiros: o aviso "podemos receber comissão" é obrigatório.' }),
});
export type ShopEntity = z.infer<typeof ShopEntity>;

export const WidgetShopParams = z.object({ id: z.uuid() });

export const WidgetShopQuery = z.object({
  kind: z.enum(SHOP_ENTITY_KINDS).meta({ description: 'De onde vem a entidade da página.' }),
  entity: z.uuid().meta({ description: 'Id do time, seleção, campeonato, atleta ou piloto da página.' }),
  event: z.uuid().optional().meta({ description: 'Jogo da página, para o relatório de cliques do cliente.' }),
  lang: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Z]{2}|-\d{3})?$/)
    .optional(),
});

export function shopPaths(): ZodOpenApiPathsObject {
  const e404 = [400, 401, 403, 404, 429, 503] as (400 | 401 | 403 | 404 | 429 | 503)[];
  return {
    '/v1/widgets/{id}/shop': {
      get: {
        ...getOp(
          'Shopping no widget do cliente: produtos da entidade nas lojas que o cliente ligou',
          'Torcedor',
          ShopEntity,
          { path: WidgetShopParams, query: WidgetShopQuery },
          e404,
        ),
        description:
          'Módulo shopping, preso a um widget `shop_the_game` do próprio tenant. Só as lojas que o cliente ligou no ' +
          'Builder, na ordem dele, com o caminho de cada uma (código próprio ou repasse pela Galaxie) e a checagem de ' +
          'destino confirmada na versão atual das regras; sem ela, a lista vem vazia. O código de afiliado da Galaxie ' +
          'nunca entra nestes links.',
      },
    },
    '/v1/shop/{kind}/{id}': {
      get: {
        ...getOp(
          'Shopping: produtos oficiais de um time, seleção, campeonato, atleta ou piloto',
          'Torcedor',
          ShopEntity,
          { path: ShopParams, query: ShopQuery },
          e404,
        ),
        description:
          'Módulo shopping. Produtos curados pela Galaxie, por loja de afiliado, com preço e estoque da loja ' +
          '(cache de no máximo 24 h). Sem produto, a lista vem vazia e o bloco não deve aparecer. Os links levam o ' +
          'código de afiliado só no destino liberado para o tenant; para clientes, o widget do Builder (#925). ' +
          'Fora dos tenants da Galaxie, a resposta é sempre 200 com a lista vazia (mesmo sem cadastro).',
      },
    },
  };
}
