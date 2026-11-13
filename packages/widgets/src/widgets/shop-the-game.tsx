'use client';

import { useCallback, useEffect, useState } from 'react';

import { fillText, sidesOf, type GsEvent, type GsShopEntity, type GsShopEntityKind } from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface ShopTheGameProps {
  /**
   * Id do widget "Shopping" salvo no Builder. As lojas, o caminho de cada uma (código do cliente ou repasse pela
   * Galaxie) e a checagem de destino ficam na configuração que só a API lê: a rota fica presa ao widget.
   */
  widgetId: string;
  /** Jogo da página: os produtos dos dois times. */
  eventId?: string | undefined;
  /** Time ou seleção da página (sem jogo). */
  teamId?: string | undefined;
  /** Campeonato da página (sem jogo nem time). */
  competitionId?: string | undefined;
  /** Atleta ou piloto da página. */
  personId?: string | undefined;
  /** Produtos por time (3 a 6, padrão 4). */
  perTeam?: number | undefined;
  /** Preço com a data da consulta à loja (padrão: sim). */
  showPrice?: boolean | undefined;
}

const SHOP_REFRESH_MS = 60 * 60_000;

interface Column {
  kind: GsShopEntityKind;
  id: string;
  name: string | null;
}

const enc = encodeURIComponent;

/**
 * Shopping no site do cliente (#925): os produtos oficiais das entidades da página (no jogo, os dois times; fora
 * dele, o time, o campeonato ou o atleta), só nas lojas que o cliente ligou no Builder. O botão abre a loja fora da
 * página e passa pela rota de cliques; o aviso de parceiro está sempre visível. Em TV, a loja aparece sem botão.
 */
export function ShopTheGame({
  widgetId,
  eventId,
  teamId,
  competitionId,
  personId,
  perTeam = 4,
  showPrice = true,
}: ShopTheGameProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.shop;
  const event = useGalaxieQuery<GsEvent>(eventId ? `/v1/events/${enc(eventId)}` : null, {}, () => null);
  const [empty, setEmpty] = useState<ReadonlySet<string>>(new Set());
  const onEmpty = useCallback(
    (key: string, isEmpty: boolean) =>
      setEmpty((prev) => {
        if (prev.has(key) === isEmpty) return prev;
        const next = new Set(prev);
        if (isEmpty) next.add(key);
        else next.delete(key);
        return next;
      }),
    [],
  );

  let columns: Column[] = [];
  if (eventId) {
    if (!event.data) {
      return (
        <WidgetFrame kind="shop_the_game" busy={event.loading}>
          <h3 className="gs-title">{t.title}</h3>
          {event.loading ? (
            <LoadingState lines={4} />
          ) : (
            <ErrorState error={event.error} onRetry={event.retry} />
          )}
        </WidgetFrame>
      );
    }
    const { home, away } = sidesOf(event.data);
    columns = [home, away]
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ kind: 'participant', id: p.id, name: p.name }));
  } else if (teamId) columns = [{ kind: 'participant', id: teamId, name: null }];
  else if (personId) columns = [{ kind: 'person', id: personId, name: null }];
  else if (competitionId) columns = [{ kind: 'competition', id: competitionId, name: null }];

  const key = (c: Column) => `${c.kind}:${c.id}`;
  const allEmpty = columns.length === 0 || columns.every((c) => empty.has(key(c)));
  return (
    <WidgetFrame kind="shop_the_game">
      <h3 className="gs-title">{t.title}</h3>
      {allEmpty && <EmptyState>{t.empty}</EmptyState>}
      {columns.length > 0 && (
        <div className="gs-shop" hidden={allEmpty}>
          {columns.map((c) => (
            <ShopColumn
              key={key(c)}
              widgetId={widgetId}
              column={c}
              eventId={eventId}
              perTeam={Math.min(6, Math.max(3, Math.round(perTeam)))}
              showPrice={showPrice}
              onEmpty={(v) => onEmpty(key(c), v)}
            />
          ))}
        </div>
      )}
      {!allEmpty && <p className="gs-shop-note">{t.disclosure}</p>}
    </WidgetFrame>
  );
}

function ShopColumn({
  widgetId,
  column,
  eventId,
  perTeam,
  showPrice,
  onEmpty,
}: {
  widgetId: string;
  column: Column;
  eventId: string | undefined;
  perTeam: number;
  showPrice: boolean;
  onEmpty: (empty: boolean) => void;
}) {
  const { texts, locale } = useGalaxieWidget();
  const t = texts.shop;
  const fmt = useFormatters();
  const query = useGalaxieQuery<GsShopEntity>(
    widgetId ? `/v1/widgets/${enc(widgetId)}/shop` : null,
    { kind: column.kind, entity: column.id, event: eventId, lang: locale },
    () => SHOP_REFRESH_MS,
  );
  // a ordem é a do cliente (lojas) e a da curadoria (produtos); os primeiros N de cada entidade
  const products = (query.data?.stores ?? [])
    .flatMap((s) => s.products.map((p) => ({ ...p, store: s.store.name, qr: s.display === 'qr' })))
    .slice(0, perTeam);
  const isEmpty = !query.loading && products.length === 0;
  // a lista vazia de todas as colunas vira um aviso só, no pai
  useReport(isEmpty, onEmpty);
  if (query.loading && !query.data) return <LoadingState lines={3} />;
  if (!products.length) return null;
  const price = (p: (typeof products)[number]) => {
    if (p.price === null || !p.currency) return null;
    try {
      return new Intl.NumberFormat(fmt.intl, { style: 'currency', currency: p.currency }).format(p.price);
    } catch {
      return null;
    }
  };
  return (
    <div className="gs-shop-col" data-gs-entity={column.id}>
      {column.name && <div className="gs-group-title">{fillText(t.productsOf, { name: column.name })}</div>}
      <ul className="gs-shop-list">
        {products.map((p) => {
          const value = showPrice ? price(p) : null;
          return (
            <li key={p.id} className="gs-shop-item">
              {p.image_url ? (
                // imagem servida pela própria loja, nunca copiada
                <img
                  className="gs-shop-img"
                  src={p.image_url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <div className="gs-shop-info">
                <span className="gs-truncate">{p.title}</span>
                <span className="gs-muted gs-small">
                  {p.qr ? fillText(t.inStore, { store: p.store }) : p.store}
                  {value ? ` · ${value}` : ''}
                  {value && p.fetched_at
                    ? ` · ${fillText(t.priceAt, { when: fmt.dateTime(p.fetched_at) })}`
                    : ''}
                </span>
              </div>
              {!p.qr && (
                <a className="gs-button" href={p.buy_url} target="_blank" rel="sponsored noopener noreferrer">
                  {t.buy}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function useReport(isEmpty: boolean, onEmpty: (empty: boolean) => void) {
  // o pai ignora a repetição do mesmo valor (sem nova renderização)
  useEffect(() => onEmpty(isEmpty), [isEmpty, onEmpty]);
}
