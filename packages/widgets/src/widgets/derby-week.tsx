'use client';

import {
  fillText,
  type GsDerbyRecord,
  type GsEvent,
  type GsUpcomingDerby,
  type GsWhereToWatch,
} from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface DerbyWeekProps {
  /** País de um dos times (ISO2; Inglaterra = `GB-ENG`). Vazio ou `all` = todos. */
  country?: string | undefined;
  /** Quantos clássicos (padrão 5; 0 = todos). */
  limit?: number | undefined;
  /** Quantos dias à frente (1–30, padrão 7). */
  days?: number | undefined;
  /** Retrospecto do confronto (padrão: ligado). */
  showHistory?: boolean | undefined;
  /** Canais do jogo no mercado do widget (padrão: ligado; pede o módulo onde assistir). */
  showWhereToWatch?: boolean | undefined;
}

const REFRESH_MS = 30 * 60_000;

/** Os grandes clássicos dos próximos dias, com data, onde assistir e o histórico do confronto. */
export function DerbyWeek({
  country = 'all',
  limit = 5,
  days = 7,
  showHistory = true,
  showWhereToWatch = true,
}: DerbyWeekProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.championship;
  const span = Math.min(30, Math.max(1, Math.round(days) || 7));
  const query = useGalaxieQuery<{ data: GsUpcomingDerby[] }>(
    '/v1/derbies/upcoming',
    { days: span, country: country && country !== 'all' ? country : undefined },
    () => REFRESH_MS,
  );
  const header = <h3 className="gs-title">{t.derbies}</h3>;
  if (!query.data) {
    return (
      <WidgetFrame kind="derby_week" busy={query.loading}>
        {header}
        {query.loading ? (
          <LoadingState lines={4} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  const all = query.data.data;
  const shown = limit > 0 ? all.slice(0, limit) : all;
  return (
    <WidgetFrame kind="derby_week">
      {header}
      {shown.length === 0 ? (
        <EmptyState>{t.emptyDerbies}</EmptyState>
      ) : (
        <ul className="gs-list" data-gs-derbies="">
          {shown.map((d) => (
            <DerbyItem
              key={d.event_id}
              item={d}
              showHistory={showHistory}
              showWhereToWatch={showWhereToWatch}
            />
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}

function DerbyItem({
  item,
  showHistory,
  showWhereToWatch,
}: {
  item: GsUpcomingDerby;
  showHistory: boolean;
  showWhereToWatch: boolean;
}) {
  const fmt = useFormatters();
  // escudos, placar e estado do jogo (a lista de clássicos traz só os nomes)
  const event = useGalaxieQuery<GsEvent>(`/v1/events/${encodeURIComponent(item.event_id)}`);
  const e = event.data;
  const side = (s: 'home' | 'away') => {
    const p = e?.participants.find((x) => x.side === s);
    const fallback = item.participants.find((x) => x.side === s);
    return { name: p?.name ?? fallback?.name ?? '', logo: p?.logo ?? null };
  };
  const home = side('home');
  const away = side('away');
  const started = e && e.status !== 'scheduled' && e.score.home !== null && e.score.away !== null;
  return (
    <li className="gs-derby" data-gs-derby={item.derby.slug}>
      <div className="gs-row-meta">
        <span className="gs-row-tag" data-tag="derby">
          {item.derby.name}
        </span>
        {item.competition ? <span className="gs-truncate">{item.competition.name}</span> : null}
        <span>{fmt.dateTime(item.starts_at)}</span>
        {e && e.status !== 'scheduled' ? <StatusBadge event={e} /> : null}
      </div>
      <div className="gs-derby-teams">
        <span className="gs-line gs-grow">
          <Crest src={home.logo} name={home.name} size="sm" />
          <span className="gs-truncate">{home.name}</span>
        </span>
        <span className="gs-strong">{started ? `${e.score.home} × ${e.score.away}` : '×'}</span>
        <span className="gs-line gs-grow" data-away="">
          <span className="gs-truncate">{away.name}</span>
          <Crest src={away.logo} name={away.name} size="sm" />
        </span>
      </div>
      {showHistory ? <DerbyHistory item={item} /> : null}
      {showWhereToWatch ? <DerbyChannels eventId={item.event_id} /> : null}
    </li>
  );
}

/** "Histórico: 380 jogos · Palmeiras 135 · Empates 107 · Corinthians 138" (geral) ou o recorte da base. */
function DerbyHistory({ item }: { item: GsUpcomingDerby }) {
  const { texts } = useGalaxieWidget();
  const t = texts.championship;
  const query = useGalaxieQuery<GsDerbyRecord>(`/v1/derbies/${encodeURIComponent(item.derby.slug)}`);
  const d = query.data;
  if (!d) return null;
  const record = d.all_time ?? (d.retrospect.available && d.retrospect.matches > 0 ? d.retrospect : null);
  if (!record) return null;
  const nameOf = (slug: string) => item.derby.teams.find((x) => x.slug === slug)?.name ?? slug;
  const since = !d.all_time && d.retrospect.since ? fillText(t.since, { year: d.retrospect.since }) : null;
  const [a, b] = record.teams;
  const parts = [
    fillText(t.matches, { n: record.matches }),
    a ? `${nameOf(a.slug)} ${a.wins}` : null,
    `${t.draws} ${record.draws}`,
    b ? `${nameOf(b.slug)} ${b.wins}` : null,
  ].filter((p): p is string => !!p);
  return (
    <p className="gs-derby-history gs-small gs-muted" data-gs-history={d.all_time ? 'all_time' : 'database'}>
      <span className="gs-strong">{`${t.allTime}: `}</span>
      {parts.join(' · ')}
      {since ? ` (${since})` : null}
    </p>
  );
}

/** Canais do jogo no mercado do widget: o canal confirmado, senão TV aberta e canais pagos com os direitos. */
function DerbyChannels({ eventId }: { eventId: string }) {
  const { texts, market } = useGalaxieWidget();
  const query = useGalaxieQuery<GsWhereToWatch>(
    market ? `/v1/events/${encodeURIComponent(eventId)}/where-to-watch` : null,
    { country: market?.toUpperCase() },
  );
  const w = query.data;
  if (!w) return null;
  const a = w.availability;
  const confirmed =
    a?.match_channel?.state === 'confirmed' ? a.match_channel.channels.map((c) => c.name) : [];
  const names = [
    ...new Set(
      confirmed.length
        ? confirmed
        : a
          ? [...a.free_tv, ...a.pay_tv_channels].map((c) => c.name)
          : w.options.map((o) => o.channel ?? o.provider),
    ),
  ].slice(0, 4);
  if (!names.length) return null;
  return (
    <div className="gs-row-tags" data-gs-watch="" aria-label={texts.championship.watch}>
      {names.map((n) => (
        <span key={n} className="gs-row-tag">
          {n}
        </span>
      ))}
    </div>
  );
}
