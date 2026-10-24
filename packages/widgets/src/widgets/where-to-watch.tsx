'use client';

import {
  BROADCAST_MEDIA,
  type GsAvailability,
  type GsAvailabilityLogo,
  type GsBroadcastMedium,
  type GsPlatformAvailability,
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

type LogoPair = { logo: string | null; logo_dark: string | null };

/**
 * Onde assistir o jogo no país. Com o bloco `availability` da API: TV aberta, canais pagos e
 * "disponível também em" (um cartão por operadora ou streaming, com o plano, os canais e os streamings
 * inclusos); com o canal a confirmar, os detentores dos direitos e um aviso. Sem o bloco (resposta
 * antiga): as opções por mídia, com o logo das emissoras e o link quando houver.
 */
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

  const { options, to_confirm: toConfirm, message, availability } = query.data;
  const dark = theme.mode === 'dark';
  const logoOf = (o: LogoPair) => (dark ? (o.logo_dark ?? o.logo) : o.logo);
  const groups = availability ? groupsOf(query.data, availability) : null;

  if (groups && groups.count > 0) {
    return (
      <WidgetFrame kind="where_to_watch">
        <h3 className="gs-title">{texts.whereToWatch}</h3>
        <Groups groups={groups} logoOf={logoOf} />
      </WidgetFrame>
    );
  }

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

// ─── agrupado (bloco `availability`) ─────────────────────────────────────────────────────────────

/** Logo solto (TV aberta, canal pago ou outro meio), com o link e a praça da opção quando há. */
interface Tile extends LogoPair {
  key: string;
  name: string;
  href: string | null;
  region: string | null;
  medium: GsBroadcastMedium | null;
}

interface Groups {
  toConfirm: boolean;
  freeTv: Tile[];
  payTv: Tile[];
  /** Cartões "disponível também em", a operadora do tenant primeiro (mesmo sem o jogo na grade). */
  cards: GsPlatformAvailability[];
  mineId: string | null;
  /** Link de assistir da opção publicada do próprio streaming (por `broadcaster_id`). */
  watchUrl: Map<string, string>;
  /** Streaming, YouTube ou app que não virou cartão de plataforma. */
  others: Tile[];
  count: number;
}

const httpUrl = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

function groupsOf(data: GsWhereToWatch, availability: GsAvailability): Groups {
  const toConfirm = availability.channel_status === 'to_confirm';
  const tile = (c: GsAvailabilityLogo): Tile => {
    const matches = data.options.filter((o) => (o.provider_id ?? o.id) === c.id);
    return {
      ...c,
      key: `${c.id}|${c.name}`,
      href: httpUrl(matches.find((o) => httpUrl(o.watch_url))?.watch_url),
      region: [...new Set(matches.flatMap((o) => (o.region ? [o.region] : [])))].join(', ') || null,
      medium: null,
    };
  };
  const inCards = new Set(
    availability.platforms.flatMap((p) => (p.platform.broadcaster_id ? [p.platform.broadcaster_id] : [])),
  );
  const loose: (GsWatchOption | GsWatchToConfirm)[] = toConfirm ? data.to_confirm : data.options;
  const seen = new Set<string>();
  const others = loose.flatMap((o): Tile[] => {
    const id = o.provider_id ?? null;
    if (o.medium === 'free_tv' || o.medium === 'pay_tv' || (id && inCards.has(id))) return [];
    const name = 'channel' in o && o.channel && o.channel !== o.provider ? o.channel : o.provider;
    const key = `${id ?? o.provider}|${name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        key,
        name,
        logo: o.logo,
        logo_dark: o.logo_dark,
        href: 'watch_url' in o ? httpUrl(o.watch_url) : null,
        region: null,
        medium: o.medium,
      },
    ];
  });
  const mine = availability.your_operator;
  const cards =
    mine && !availability.platforms.some((p) => p.platform.id === mine.platform.id)
      ? [mine, ...availability.platforms]
      : availability.platforms;
  const watchUrl = new Map(
    data.options.flatMap((o) => {
      const href = httpUrl(o.watch_url);
      return o.provider_id && href ? [[o.provider_id, href] as const] : [];
    }),
  );
  const freeTv = availability.free_tv.map(tile);
  const payTv = availability.pay_tv_channels.map(tile);
  return {
    toConfirm,
    freeTv,
    payTv,
    cards,
    mineId: mine?.platform.id ?? null,
    watchUrl,
    others,
    // a operadora do tenant sozinha, sem o jogo na grade, não basta para trocar o modo
    count: freeTv.length + payTv.length + availability.platforms.length + others.length,
  };
}

function Groups({ groups, logoOf }: { groups: Groups; logoOf: (o: LogoPair) => string | null }) {
  const { texts } = useGalaxieWidget();
  const t = texts.watchGroups;
  const tiles = (list: Tile[]) => (
    <ul className="gs-tiles">
      {list.map((item) => (
        <TileItem key={item.key} item={item} logo={logoOf(item)} toConfirm={groups.toConfirm} />
      ))}
    </ul>
  );
  return (
    <>
      {groups.toConfirm ? (
        <div className="gs-notice" role="note" data-gs-to-confirm>
          <strong>{t.toConfirmTitle}</strong>
          <span className="gs-muted gs-small">{t.toConfirmHint}</span>
        </div>
      ) : null}
      {groups.freeTv.length ? (
        <div className="gs-group" data-gs-group="free_tv">
          <div className="gs-group-title">{t.freeTv}</div>
          {tiles(groups.freeTv)}
        </div>
      ) : null}
      {groups.payTv.length ? (
        <div className="gs-group" data-gs-group="pay_tv">
          <div className="gs-group-title">{t.payTv}</div>
          {tiles(groups.payTv)}
        </div>
      ) : null}
      {groups.cards.length + groups.others.length > 0 ? (
        <div className="gs-group" data-gs-group="also_on">
          <div className="gs-group-title">{t.alsoOn}</div>
          {groups.cards.length ? (
            <div className="gs-cards">
              {groups.cards.map((entry) => (
                <PlatformCard
                  key={entry.platform.id}
                  entry={entry}
                  mine={entry.platform.id === groups.mineId}
                  href={
                    entry.platform.broadcaster_id
                      ? (groups.watchUrl.get(entry.platform.broadcaster_id) ?? null)
                      : null
                  }
                  logoOf={logoOf}
                />
              ))}
            </div>
          ) : null}
          {groups.others.length ? tiles(groups.others) : null}
        </div>
      ) : null}
    </>
  );
}

function TileItem({ item, logo, toConfirm }: { item: Tile; logo: string | null; toConfirm: boolean }) {
  const { texts } = useGalaxieWidget();
  const body = (
    <>
      <Crest src={logo} name={item.name} className="gs-logo" />
      <span>{item.name}</span>
      {item.medium ? <span className="gs-muted gs-small">{texts.media[item.medium]}</span> : null}
      {item.region ? <span className="gs-muted gs-small">{item.region}</span> : null}
    </>
  );
  const marks = toConfirm ? { 'data-to-confirm': '' } : {};
  return (
    <li>
      {item.href ? (
        <a className="gs-tile" href={item.href} target="_blank" rel="noopener noreferrer" {...marks}>
          {body}
        </a>
      ) : (
        <div className="gs-tile" {...marks}>
          {body}
        </div>
      )}
    </li>
  );
}

function Chips({ items, logoOf }: { items: GsAvailabilityLogo[]; logoOf: (o: LogoPair) => string | null }) {
  return (
    <ul className="gs-chips">
      {items.map((c) => (
        <li key={c.id} className="gs-chip" title={c.name}>
          <Crest src={logoOf(c)} name={c.name} className="gs-logo" />
          <span className="gs-truncate">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** Cartão da plataforma: logo, tipo e, por plano, os canais com o jogo e os streamings inclusos. */
function PlatformCard({
  entry,
  mine,
  href,
  logoOf,
}: {
  entry: GsPlatformAvailability;
  mine: boolean;
  /** Link da opção publicada quando a plataforma é o próprio streaming do jogo. */
  href: string | null;
  logoOf: (o: LogoPair) => string | null;
}) {
  const { texts } = useGalaxieWidget();
  const t = texts.watchGroups;
  const { platform, plans } = entry;
  const credit = platform.logo_credit ?? null;
  return (
    <div className="gs-platform" data-gs-platform={platform.kind} {...(mine ? { 'data-mine': '' } : {})}>
      <div className="gs-platform-head">
        <span title={credit?.text}>
          <Crest src={logoOf(platform)} name={platform.name} className="gs-logo" />
        </span>
        <div className="gs-watch-text">
          <strong className="gs-platform-name">{platform.name}</strong>
          <span className="gs-muted gs-small">{t.kind[platform.kind] ?? platform.kind}</span>
        </div>
        {mine ? (
          <span className="gs-badge" data-tone="primary">
            {t.yourOperator}
          </span>
        ) : null}
        {href ? (
          <a className="gs-link" href={href} target="_blank" rel="noopener noreferrer">
            {texts.watch}
          </a>
        ) : null}
      </div>
      {plans.length ? (
        plans.map((plan) => (
          <div key={plan.id} className="gs-plan">
            <div className="gs-plan-head">
              <span>{plan.name}</span>
              <span className="gs-pill" data-access={plan.access}>
                {plan.access === 'included' ? t.included : t.addon}
              </span>
            </div>
            {plan.via_channels.length ? <Chips items={plan.via_channels} logoOf={logoOf} /> : null}
            {plan.included_services.length ? (
              <>
                <span className="gs-muted gs-small">{t.includedServices}</span>
                <Chips items={plan.included_services} logoOf={logoOf} />
              </>
            ) : null}
          </div>
        ))
      ) : (
        <div className="gs-plan gs-muted gs-small">{t.notInYourOperator}</div>
      )}
      {credit?.attribution_required ? (
        <a className="gs-credit" href={credit.page_url} target="_blank" rel="noopener noreferrer">
          {credit.text}
        </a>
      ) : null}
    </div>
  );
}

// ─── lista por mídia (resposta sem `availability`) ───────────────────────────────────────────────

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
