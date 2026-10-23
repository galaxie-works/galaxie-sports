'use client';

import {
  BROADCAST_MEDIA,
  type GsBroadcastMedium,
  type GsWatchOption,
  type GsWatchToConfirm,
  type GsWhereToWatch,
} from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface WhereToWatchProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
  /** País ISO2 (ex.: BR). */
  market: string;
  /** UF/praça da TV aberta regional (ex.: SP). */
  region?: string | undefined;
}

/** Onde assistir o jogo no país: opções por mídia, com o logo das emissoras e o link quando houver. */
export function WhereToWatch({ eventId, market, region }: WhereToWatchProps) {
  const { texts, theme } = useGalaxieWidget();
  const query = useGalaxieQuery<GsWhereToWatch>(
    eventId && market ? `/v1/events/${encodeURIComponent(eventId)}/where-to-watch` : null,
    { country: market.toUpperCase(), region },
  );

  if (!query.data) {
    return (
      <WidgetFrame kind="where_to_watch" busy={query.loading}>
        <h3 className="gs-title">{texts.whereToWatch}</h3>
        {query.loading ? (
          <LoadingState lines={3} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const { options, to_confirm: toConfirm, message } = query.data;
  const dark = theme.mode === 'dark';
  const logoOf = (o: { logo: string | null; logo_dark: string | null }) =>
    dark ? (o.logo_dark ?? o.logo) : o.logo;
  const byMedium = BROADCAST_MEDIA.map(
    (medium) => [medium, options.filter((o) => o.medium === medium)] as const,
  ).filter(([, list]) => list.length > 0);

  return (
    <WidgetFrame kind="where_to_watch">
      <h3 className="gs-title">{texts.whereToWatch}</h3>
      {byMedium.length === 0 && toConfirm.length === 0 ? (
        <EmptyState>{message ?? texts.emptyWatch}</EmptyState>
      ) : null}
      {byMedium.map(([medium, list]) => (
        <div key={medium} className="gs-group" data-gs-medium={medium}>
          <div className="gs-group-title">{texts.media[medium]}</div>
          <ul className="gs-list">
            {list.map((option) => (
              <OptionRow key={option.id} option={option} logo={logoOf(option)} />
            ))}
          </ul>
        </div>
      ))}
      {toConfirm.length > 0 ? (
        <div className="gs-group">
          <div className="gs-group-title">{texts.toConfirm}</div>
          <ul className="gs-list">
            {toConfirm.map((item) => (
              <ToConfirmRow key={`${item.provider}-${item.medium}`} item={item} logo={logoOf(item)} />
            ))}
          </ul>
        </div>
      ) : null}
    </WidgetFrame>
  );
}

function AccessText({
  medium,
  access,
}: {
  medium: GsBroadcastMedium;
  access: GsWatchOption['access_model'];
}) {
  const { texts } = useGalaxieWidget();
  const label = texts.access[access];
  return <span className="gs-muted gs-small">{label || texts.media[medium]}</span>;
}

function OptionRow({ option, logo }: { option: GsWatchOption; logo: string | null }) {
  const { texts } = useGalaxieWidget();
  const name = option.channel && option.channel !== option.provider ? option.channel : option.provider;
  return (
    <li className="gs-watch" data-gs-provider={option.provider}>
      <Crest src={logo} name={option.provider} className="gs-logo" />
      <div className="gs-watch-text">
        <span className="gs-truncate">
          {name}
          {option.region ? <span className="gs-muted"> · {option.region}</span> : null}
        </span>
        <AccessText medium={option.medium} access={option.access_model} />
      </div>
      {option.watch_url && /^https?:\/\//i.test(option.watch_url) ? (
        <a className="gs-link" href={option.watch_url} target="_blank" rel="noopener noreferrer">
          {texts.watch}
        </a>
      ) : null}
    </li>
  );
}

function ToConfirmRow({ item, logo }: { item: GsWatchToConfirm; logo: string | null }) {
  return (
    <li className="gs-watch">
      <Crest src={logo} name={item.provider} className="gs-logo" />
      <div className="gs-watch-text">
        <span className="gs-truncate">{item.provider}</span>
        <AccessText medium={item.medium} access={item.access_model} />
      </div>
    </li>
  );
}
