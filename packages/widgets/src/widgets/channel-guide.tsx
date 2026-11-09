'use client';

import {
  LIVE_STATUSES,
  STARTED_STATUSES,
  fillText,
  isoDate,
  localTimeZone,
  sidesOf,
  type GsChannelGuide,
  type GsEvent,
  type GsParticipant,
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

export interface ChannelGuideProps {
  /**
   * Id do widget "Grade nos canais" salvo no Builder. A grade sai da lista de canais do cliente, que só a
   * API lê: a rota fica presa ao widget e entrega só a grade pronta.
   */
  widgetId: string;
  /** Dia da grade (padrão: hoje). */
  day?: 'today' | 'tomorrow' | undefined;
  /** Só este esporte (`football`), ou vários separados por vírgula. Padrão: o salvo no widget, ou todos. */
  sport?: string | undefined;
  /** Agrupar por horário (padrão) ou por canal. */
  groupBy?: 'time' | 'channel' | undefined;
  /** Nome do campeonato em cada jogo (padrão: sim). */
  showCompetition?: boolean | undefined;
  /** Placar dos jogos em andamento e encerrados (padrão: sim). */
  showScore?: boolean | undefined;
}

const LIVE_REFRESH_MS = 60_000;
const DAY_REFRESH_MS = 10 * 60_000;

type Entry = GsChannelGuide['entries'][number];

/**
 * O que passa no dia, hora a hora, nos canais que o cliente tem (operadoras de TV e apps de streaming): cada
 * jogo com os canais da lista dele que o transmitem, agrupado pelo horário de início ou pelo canal.
 */
export function ChannelGuide({
  widgetId,
  day = 'today',
  sport,
  groupBy = 'time',
  showCompetition = true,
  showScore = true,
}: ChannelGuideProps) {
  const { texts, timeZone } = useGalaxieWidget();
  const t = texts.channelGuide;
  const fmt = useFormatters();
  const tz = timeZone ?? localTimeZone();
  const today = isoDate(new Date(), tz);
  const date = day === 'tomorrow' ? addDays(today, 1) : today;
  const query = useGalaxieQuery<GsChannelGuide>(
    widgetId ? `/v1/widgets/${encodeURIComponent(widgetId)}/channel-guide` : null,
    { date, sport },
    (d) => (d.entries.some((e) => LIVE_STATUSES.has(e.event.status)) ? LIVE_REFRESH_MS : DAY_REFRESH_MS),
  );
  const title = day === 'tomorrow' ? t.tomorrow : t.today;
  const d = query.data;
  if (!d) {
    return (
      <WidgetFrame kind="channel_guide" busy={query.loading}>
        <h3 className="gs-title">{title}</h3>
        {query.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  // a grade é de outro dia quando a virada da meia-noite chega antes da próxima atualização
  const heading =
    d.date === today
      ? t.today
      : d.date === addDays(today, 1)
        ? t.tomorrow
        : fillText(t.day, { date: fmt.dayMonth(`${d.date}T12:00:00Z`) });
  const row = { competition: showCompetition, score: showScore, channelsLabel: t.channels };
  return (
    <WidgetFrame kind="channel_guide">
      <h3 className="gs-title">{heading}</h3>
      {d.status === 'no_channel_list' ? (
        <EmptyState>{t.noList}</EmptyState>
      ) : d.entries.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : groupBy === 'channel' ? (
        groupByChannel(d).map((g) => (
          <div key={g.channel} className="gs-group" data-gs-channel={g.channel}>
            <div className="gs-group-title">
              <span className="gs-truncate">{g.channel}</span>
            </div>
            <ul className="gs-list">
              {g.entries.map((e) => (
                <GuideRow
                  key={e.event.id}
                  entry={e}
                  time={fmt.time(e.event.starts_at)}
                  channels={false}
                  {...row}
                />
              ))}
            </ul>
          </div>
        ))
      ) : (
        groupByTime(d.entries, fmt.time).map((g) => (
          <div key={g.time} className="gs-group" data-gs-slot={g.time}>
            <div className="gs-group-title">
              <time dateTime={g.entries[0]!.event.starts_at}>{g.time}</time>
            </div>
            <ul className="gs-list">
              {g.entries.map((e) => (
                <GuideRow key={e.event.id} entry={e} time={g.time} channels {...row} />
              ))}
            </ul>
          </div>
        ))
      )}
    </WidgetFrame>
  );
}

/** Jogos pelo horário de início (no fuso do leitor), na ordem da grade. */
function groupByTime(entries: Entry[], time: (iso: string) => string) {
  const groups: { time: string; entries: Entry[] }[] = [];
  for (const e of entries) {
    const slot = time(e.event.starts_at);
    const last = groups[groups.length - 1];
    if (last && last.time === slot) last.entries.push(e);
    else groups.push({ time: slot, entries: [e] });
  }
  return groups;
}

/** Um grupo por canal (na ordem alfabética da grade), com os jogos dele pelo horário. */
function groupByChannel(d: GsChannelGuide) {
  return d.channels
    .map((channel) => ({ channel, entries: d.entries.filter((e) => e.channels.includes(channel)) }))
    .filter((g) => g.entries.length > 0);
}

/** Dia civil AAAA-MM-DD somado de `n` dias pelo calendário. */
function addDays(isoDay: string, n: number): string {
  const [y, m, d] = isoDay.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function GuideRow({
  entry,
  time,
  channels,
  competition,
  score,
  channelsLabel,
}: {
  entry: Entry;
  time: string;
  /** Os canais do jogo na linha (agrupado por horário). */
  channels: boolean;
  competition: boolean;
  score: boolean;
  channelsLabel: string;
}) {
  const event: GsEvent = entry.event;
  const { home, away } = sidesOf(event);
  const started = score && STARTED_STATUSES.has(event.status);
  const showBadge = STARTED_STATUSES.has(event.status) || event.status !== 'scheduled';
  const comp = competition ? event.competition : null;
  return (
    <li className="gs-row" data-gs-event={event.id}>
      <div className="gs-row-status">
        {showBadge ? <StatusBadge event={event} /> : <time dateTime={event.starts_at}>{time}</time>}
      </div>
      <div className="gs-row-teams">
        {home || away ? (
          <>
            <Line p={home} goals={started ? event.score.home : null} />
            <Line p={away} goals={started ? event.score.away : null} />
          </>
        ) : (
          <div className="gs-line">
            <span className="gs-truncate">{event.competition?.name ?? ''}</span>
          </div>
        )}
        {comp ? (
          <div className="gs-row-meta">
            <span data-gs-meta="competition">
              <span className="gs-truncate">
                {event.stage?.name ? `${comp.name} · ${event.stage.name}` : comp.name}
              </span>
            </span>
          </div>
        ) : null}
        {channels && entry.channels.length ? (
          <div className="gs-row-tags" aria-label={channelsLabel}>
            {entry.channels.map((c) => (
              <span key={c} className="gs-row-tag" data-tag="channel">
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Line({ p, goals }: { p: GsParticipant | undefined; goals: number | null }) {
  if (!p) return null;
  return (
    <div className="gs-line" data-lost={p.winner === false || undefined}>
      <Crest src={p.logo} name={p.name} size="sm" />
      <span className="gs-truncate">{p.name}</span>
      {goals !== null ? <span className="gs-line-score">{goals}</span> : null}
    </div>
  );
}
