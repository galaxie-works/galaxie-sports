'use client';

import { useMemo } from 'react';
import { fillText, intlLocale, type GsTransfer, type GsTransferList } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export type TransferMarketDirection = 'all' | 'in' | 'out';

export interface TransferMarketProps {
  /** Id do time na API Galaxie: as contratações e saídas dele. */
  teamId?: string | undefined;
  /** UUID ou slug de um campeonato: as dos times dele (usado quando não há `teamId`). */
  competitionId?: string | undefined;
  /** Entradas, saídas ou as duas (padrão). */
  direction?: TransferMarketDirection | undefined;
  /** Período: os últimos N dias (padrão 180). */
  days?: number | undefined;
  /** Quantas transferências (padrão 10). */
  limit?: number | undefined;
  /** Chegadas e saídas em blocos separados (padrão: sim; só com as duas direções). */
  groupByDirection?: boolean | undefined;
  /** Tipo de cada uma: empréstimo, compra (com o valor), sem custo (padrão: sim). */
  showType?: boolean | undefined;
  /** Foto do jogador (padrão: sim). */
  showPhoto?: boolean | undefined;
  /** Data de cada transferência (padrão: sim). */
  showDate?: boolean | undefined;
}

const REFRESH_MS = 60 * 60_000;

/** Vai e vem do mercado: quem chegou e quem saiu de um time (ou dos times de um campeonato), com data e clube. */
export function TransferMarket({
  teamId,
  competitionId,
  direction = 'all',
  days = 180,
  limit = 10,
  groupByDirection = true,
  showType = true,
  showPhoto = true,
  showDate = true,
}: TransferMarketProps) {
  const { texts, locale, market } = useGalaxieWidget();
  const t = texts.transfers;
  const path = teamId
    ? `/v1/teams/${encodeURIComponent(teamId)}/transfers`
    : competitionId
      ? `/v1/competitions/${encodeURIComponent(competitionId)}/transfers`
      : null;
  const query = useGalaxieQuery<GsTransferList>(
    path,
    { direction, days: Math.max(1, days), limit: Math.max(1, limit) },
    () => REFRESH_MS,
  );
  // a data vem sem hora (AAAA-MM-DD): formatada em UTC para não andar um dia para trás no fuso do leitor
  const day = useMemo(() => {
    const f = new Intl.DateTimeFormat(intlLocale(locale, market), {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      timeZone: 'UTC',
    });
    return (iso: string | null) => {
      const d = iso ? new Date(`${iso}T00:00:00Z`) : null;
      return d && !Number.isNaN(d.getTime()) ? f.format(d) : '';
    };
  }, [locale, market]);

  if (!path) {
    return (
      <WidgetFrame kind="transfer_market">
        <h3 className="gs-title">{t.title}</h3>
        <EmptyState>{t.pick}</EmptyState>
      </WidgetFrame>
    );
  }
  if (!query.data) {
    return (
      <WidgetFrame kind="transfer_market" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={6} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const { scope, data } = query.data;
  const row = (x: GsTransfer, i: number) => (
    <TransferRow
      key={`${x.person.id}-${x.date ?? ''}-${i}`}
      transfer={x}
      scope={scope.type}
      date={showDate ? day(x.date) : ''}
      showType={showType}
      showPhoto={showPhoto}
    />
  );
  const grouped = direction === 'all' && groupByDirection;
  const arrivals = data.filter((x) => x.direction === 'in');
  const departures = data.filter((x) => x.direction === 'out');
  return (
    <WidgetFrame kind="transfer_market">
      <header className="gs-header">
        <Crest src={scope.logo} name={scope.name} size="sm" />
        <h3 className="gs-title gs-truncate">{fillText(t.titleOf, { name: scope.name })}</h3>
      </header>
      {data.length === 0 ? <EmptyState>{t.empty}</EmptyState> : null}
      {grouped ? (
        <>
          {arrivals.length ? (
            <div className="gs-group">
              <div className="gs-group-title">{t.arrivals}</div>
              <ul className="gs-list">{arrivals.map(row)}</ul>
            </div>
          ) : null}
          {departures.length ? (
            <div className="gs-group">
              <div className="gs-group-title">{t.departures}</div>
              <ul className="gs-list">{departures.map(row)}</ul>
            </div>
          ) : null}
        </>
      ) : data.length ? (
        <ul className="gs-list">{data.map(row)}</ul>
      ) : null}
    </WidgetFrame>
  );
}

function TransferRow({
  transfer: x,
  scope,
  date,
  showType,
  showPhoto,
}: {
  transfer: GsTransfer;
  scope: 'team' | 'competition';
  date: string;
  showType: boolean;
  showPhoto: boolean;
}) {
  const { texts } = useGalaxieWidget();
  const t = texts.transfers;
  const incoming = x.direction === 'in';
  const kind = showType && x.kind ? (x.kind === 'fee' && x.fee ? x.fee : t.kind[x.kind]) : null;
  // no time, só o outro clube ("de X" / "para Y"); no campeonato, a ida e a volta ("X → Y")
  const other = incoming ? x.from : x.to;
  return (
    <li className="gs-fixture" data-gs-person={x.person.id} data-gs-direction={x.direction}>
      <span
        className="gs-transfer-dir"
        data-dir={x.direction}
        role="img"
        aria-label={incoming ? t.in : t.out}
        title={incoming ? t.in : t.out}
      >
        {incoming ? '↓' : '↑'}
      </span>
      {showPhoto ? <Crest src={x.person.photo} name={x.person.name} size="sm" /> : null}
      <span className="gs-grow" style={{ minWidth: 0 }}>
        <span className="gs-truncate gs-strong">{x.person.name}</span>
        <span className="gs-line gs-meta">
          {scope === 'team' ? (
            <>
              {other.name ? <Crest src={other.logo} name={other.name} size="xs" /> : null}
              <span className="gs-truncate">
                {other.name ? fillText(incoming ? t.from : t.to, { club: other.name }) : null}
                {other.name && kind ? ' · ' : null}
                {kind}
              </span>
            </>
          ) : (
            <>
              <Crest src={x.from.logo} name={x.from.name} size="xs" />
              <span className="gs-truncate">{x.from.name}</span>
              <span aria-hidden="true">→</span>
              <Crest src={x.to.logo} name={x.to.name} size="xs" />
              <span className="gs-truncate">{x.to.name}</span>
            </>
          )}
        </span>
      </span>
      {date || (scope === 'competition' && kind) ? (
        <span
          className="gs-meta"
          style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}
        >
          {date ? <time dateTime={x.date ?? undefined}>{date}</time> : null}
          {/* no campeonato a linha de baixo já tem os dois clubes: o tipo vai embaixo da data */}
          {scope === 'competition' && kind ? <span>{kind}</span> : null}
        </span>
      ) : null}
    </li>
  );
}
