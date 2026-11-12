import type { ShopEntity } from '@galaxie/contracts';
import { orderShopProducts, type ShopGameContext } from '@galaxie/engage';
import { ExternalLink, ShoppingBag } from 'lucide-react';

import { Frame, FramePanel } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/sport/section';
import { getShop } from '@/lib/galaxie/api';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export interface ShopShelfEntity {
  kind: 'participant' | 'competition' | 'person';
  id: string;
  name: string;
}

type Product = ShopEntity['stores'][number]['products'][number] & { storeName: string };

/**
 * Vitrine do Shopping (#921): os produtos oficiais das entidades da página (na partida, os dois times e o
 * campeonato; no time, só ele), em colunas, cada uma com foto, nome, preço com a data e a hora da consulta, loja e
 * "Comprar". Entidade sem produto não aparece; sem nenhuma, o bloco some. O aviso de parceiro está sempre visível.
 * O link abre fora (nova aba no site; no app, o navegador do sistema) e passa pela rota de cliques.
 */
export async function ShopShelf({
  entities,
  country,
  eventId,
  game,
}: {
  entities: ShopShelfEntity[];
  country: string;
  eventId?: string;
  /** Contexto do jogo (#923): status, clássico e fase ordenam os produtos. */
  game?: ShopGameContext;
}) {
  const [{ locale, t }, f] = await Promise.all([getI18n(), getFormatters()]);
  const T = t.shopping.shelf;
  const loaded = await Promise.all(
    entities.map(async (e) => ({ e, shop: await getShop(e.kind, e.id, country, locale, eventId) })),
  );
  const columns = loaded
    .map(({ e, shop }) => ({
      e,
      products: (shop?.stores ?? []).flatMap((s) =>
        s.products.map((p, i): Product & { position: number } => ({
          ...p,
          storeName: s.store.name,
          position: i,
        })),
      ),
    }))
    .filter((c) => c.products.length);
  if (!columns.length) return null;

  // a ordem do contexto do jogo (#923) vale por coluna; fora do jogo, a da curadoria
  const ordered = orderShopProducts(
    columns.map((c) => ({
      teamId: c.e.id,
      products: c.products.map((p) => ({
        id: p.id,
        productType: p.product_type,
        position: p.position,
        available: true,
        price: p.price,
        source: p.source,
      })),
    })),
    game ?? { status: 'scheduled' },
    { perTeam: 6 },
  );
  const byId = new Map(columns.flatMap((c) => c.products.map((p) => [p.id, p] as const)));
  const price = (p: Product) =>
    p.price !== null && p.currency
      ? new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency }).format(p.price)
      : null;

  return (
    <Section title={T.title} icon={<ShoppingBag className="size-4" aria-hidden />}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ordered.teams.map((team) => {
          const col = columns.find((c) => c.e.id === team.teamId)!;
          return (
            <Frame key={team.teamId}>
              <FramePanel className="flex flex-col gap-3 p-4">
                <h3 className="text-sm font-medium">{fill(T.productsOf, { name: col.e.name })}</h3>
                <ul className="flex flex-col gap-3">
                  {team.products.map((o) => {
                    const p = byId.get(o.id)!;
                    const value = price(p);
                    return (
                      <li key={p.id} className="flex items-center gap-3">
                        {p.image_url ? (
                          // imagem servida pela própria loja, nunca copiada (regra do épico)
                          <img
                            src={p.image_url}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="bg-muted size-14 shrink-0 rounded-md object-contain"
                          />
                        ) : (
                          <div className="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-md">
                            <ShoppingBag className="size-5" aria-hidden />
                          </div>
                        )}
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{p.title}</span>
                          <span className="text-muted-foreground text-xs">
                            {p.storeName}
                            {value ? ` · ${value}` : ''}
                            {value && p.fetched_at
                              ? ` · ${fill(T.priceAt, { when: f.dateTime(p.fetched_at) })}`
                              : ''}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          render={<a href={p.buy_url} target="_blank" rel="sponsored noopener noreferrer" />}
                        >
                          {T.buy}
                          <ExternalLink aria-hidden />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </FramePanel>
            </Frame>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">{T.disclosure}</p>
    </Section>
  );
}
