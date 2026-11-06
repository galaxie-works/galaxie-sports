'use client';

import { type GsMedalTable } from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  Flag,
  LoadingState,
  MedalDot,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
  useGamesSlug,
} from '../core/react.js';

export interface MedalTableProps {
  /** Edição dos Jogos (`og-summer-2024`). Sem ela, a em andamento ou a última. */
  games?: string | undefined;
  /** Ordem: por ouros (padrão) ou pelo total. */
  sort?: 'gold' | 'total' | undefined;
  /** `latam` = só os países da América Latina (as posições continuam as gerais). */
  region?: 'all' | 'latam' | undefined;
  /** Quantos países (padrão 10; 0 = todos). */
  limit?: number | undefined;
  /** País em destaque, pelo código do COI (padrão BRA). Fora do recorte, entra no fim. */
  highlight?: string | undefined;
}

const LIVE_REFRESH_MS = 2 * 60_000;
const DONE_REFRESH_MS = 6 * 60 * 60_000;

/** Quadro de medalhas da edição: posição, país com a bandeira, ouro, prata, bronze e total. */
export function MedalTable({
  games,
  sort = 'gold',
  region = 'all',
  limit = 10,
  highlight = 'BRA',
}: MedalTableProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.olympics;
  const edition = useGamesSlug(games);
  const query = useGalaxieQuery<GsMedalTable>(
    edition.slug ? `/v1/multisport/games/${encodeURIComponent(edition.slug)}/medals` : null,
    { sort, region: region === 'latam' ? 'latam' : undefined },
    (m) => (m.games.status === 'in_progress' ? LIVE_REFRESH_MS : DONE_REFRESH_MS),
  );
  const m = query.data;
  if (!m) {
    const state = edition.slug ? query : edition;
    return (
      <WidgetFrame kind="medal_table" busy={state.loading}>
        <h3 className="gs-title">{t.medals}</h3>
        {state.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={state.error} onRetry={state.retry} />
        )}
      </WidgetFrame>
    );
  }
  const code = highlight?.toUpperCase();
  const top = limit > 0 ? m.data.slice(0, limit) : m.data;
  const mine = code ? m.data.find((r) => r.noc.code === code) : undefined;
  const rows = mine && !top.includes(mine) ? [...top, mine] : top;
  return (
    <WidgetFrame kind="medal_table">
      <h3 className="gs-title gs-truncate">{`${t.medals} · ${m.games.name}`}</h3>
      {m.data.length === 0 ? (
        <EmptyState>{t.withheld}</EmptyState>
      ) : (
        <table className="gs-table" data-gs-medals="">
          <thead>
            <tr>
              <th className="gs-left" scope="col">
                #
              </th>
              <th className="gs-left" scope="col">
                {t.country}
              </th>
              <th scope="col">
                <MedalDot medal="G" label={t.gold} />
              </th>
              <th scope="col">
                <MedalDot medal="S" label={t.silver} />
              </th>
              <th scope="col">
                <MedalDot medal="B" label={t.bronze} />
              </th>
              <th scope="col">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.noc.code}
                className={r.noc.code === code ? 'gs-highlight' : undefined}
                data-gs-noc={r.noc.code}
              >
                <td className="gs-left gs-rank">{r.rank}</td>
                <td className="gs-left">
                  <div className="gs-line">
                    <Flag iso2={r.noc.iso2} code={r.noc.code} name={r.noc.name} />
                    <span className="gs-truncate">{r.noc.name}</span>
                  </div>
                </td>
                <td className={sort === 'gold' ? 'gs-strong' : undefined}>{r.gold}</td>
                <td>{r.silver}</td>
                <td>{r.bronze}</td>
                <td className={sort === 'total' ? 'gs-strong' : undefined}>{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </WidgetFrame>
  );
}
