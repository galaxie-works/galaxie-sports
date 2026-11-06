'use client';

import {
  LIVE_STATUSES,
  fillText,
  sidesOf,
  type GsEvent,
  type GsHeadToHead,
  type GsUpcomingDerby,
  type GsWatchOption,
  type GsWatchToConfirm,
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

export interface UpcomingDerbiesProps {
  /** País de um dos times (ISO2, `GB-ENG` para a Inglaterra). Vazio ou `all` = todos. */
  country?: string | undefined;
  /** Quantos clássicos listar (padrão 5). */
  limit?: number | undefined;
  /** Janela em dias a partir de agora (1–30, padrão 7). */
  days?: number | undefined;
  /** Campeonato de cada jogo (padrão: sim). */
  showCompetition?: boolean | undefined;
  /** Retrospecto do confronto: vitórias de cada lado e empates (padrão: sim). */
  showHistory?: boolean | undefined;
  /** Onde assistir no país do widget (padrão: sim). */
  showWhereToWatch?: boolean | undefined;
}

/** A lista muda quando um jogo é marcado ou começa: 15 minutos. */
const LIST_REFRESH_MS = 15 * 60_000;
/** Retrospecto e transmissões mudam pouco antes do jogo: 1 hora. */
const DETAIL_REFRESH_MS = 60 * 60_000;
/** Canais por clássico (o resto fica no widget "Onde assistir"). */
const MAX_CHANNELS = 4;

const clamp = (n: number | undefined, min: number, max: number, def: number) =>
  Math.min(Math.max(Math.round(n ?? def) || def, min), max);

/**
 * Os grandes clássicos dos próximos dias (`/v1/derbies/upcoming`): o nome do clássico, a rivalidade, a data
 * no horário do leitor, os times, o campeonato e, por jogo, o retrospecto e onde assistir.
 */
export function UpcomingDerbies({
  country,
  limit = 5,
  days = 7,
  showCompetition = true,
  showHistory = true,
  showWhereToWatch = true,
}: UpcomingDerbiesProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.derbies;
  const span = clamp(days, 1, 30, 7);
  const max = clamp(limit, 1, 20, 5);
  const code = country?.trim().toUpperCase();
  const query = useGalaxieQuery<{ data: GsUpcomingDerby[] }>(
    '/v1/derbies/upcoming',
    { days: span, country: code && code !== 'ALL' ? code : undefined },
    () => LIST_REFRESH_MS,
  );
  const title = span === 7 ? t.title : fillText(t.titleDays, { n: span });

  if (!query.data) {
    return (
      <WidgetFrame kind="upcoming_derbies" busy={query.loading}>
        <h3 className="gs-title">{title}</h3>
        {query.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const list = query.data.data.slice(0, max);
  return (
    <WidgetFrame kind="upcoming_derbies">
      <h3 className="gs-title">{title}</h3>
      {list.length === 0 ? (
        <EmptyState>{fillText(t.empty, { n: span })}</EmptyState>
      ) : (
        <ul className="gs-derbies">
          {list.map((d) => (
            <DerbyRow
              key={d.event_id}
              item={d}
              showCompetition={showCompetition}
              showHistory={showHistory}
              showWhereToWatch={showWhereToWatch}
            />
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}

function DerbyRow({
  item,
  showCompetition,
  showHistory,
  showWhereToWatch,
}: {
  item: GsUpcomingDerby;
  showCompetition: boolean;
  showHistory: boolean;
  showWhereToWatch: boolean;
}) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const t = texts.derbies;
  const id = encodeURIComponent(item.event_id);
  // o jogo completo traz os escudos e o estado (pode ter começado depois da lista)
  const event = useGalaxieQuery<GsEvent>(`/v1/events/${id}`, {}, () => DETAIL_REFRESH_MS);
  const e = event.data;
  const sides = e ? sidesOf(e) : null;
  const named = (side: 'home' | 'away') => item.participants.find((p) => p.side === side);
  const home = { name: sides?.home?.name ?? named('home')?.name ?? '', logo: sides?.home?.logo ?? null };
  const away = { name: sides?.away?.name ?? named('away')?.name ?? '', logo: sides?.away?.logo ?? null };
  const live = e ? LIVE_STATUSES.has(e.status) : false;
  const { derby } = item;

  return (
    <li className="gs-derby" data-gs-event={item.event_id} data-gs-derby={derby.slug}>
      <div className="gs-derby-head">
        <strong className="gs-truncate">{derby.name}</strong>
        <span className="gs-tag">{t.scopes[derby.scope] ?? derby.scope}</span>
        <span className="gs-spacer" />
        <Intensity value={derby.intensity} label={fillText(t.intensity, { n: derby.intensity })} />
      </div>
      <div className="gs-derby-match">
        {live && e ? (
          <StatusBadge event={e} />
        ) : (
          <time className="gs-fixture-date" dateTime={item.starts_at}>
            {fmt.dateTime(item.starts_at)}
          </time>
        )}
        <span className="gs-meeting">
          <Crest src={home.logo} name={home.name} size="xs" />
          <span className="gs-truncate">{home.name}</span>
          <span className="gs-muted">{texts.versus}</span>
          <span className="gs-truncate">{away.name}</span>
          <Crest src={away.logo} name={away.name} size="xs" />
        </span>
      </div>
      {showCompetition && item.competition ? (
        <span className="gs-meta gs-truncate" data-gs-meta="competition">
          {item.competition.name}
        </span>
      ) : null}
      {showHistory ? (
        <DerbyHistory eventId={item.event_id} homeId={named('home')?.id} awayId={named('away')?.id} />
      ) : null}
      {showWhereToWatch ? <DerbyWatch eventId={item.event_id} /> : null}
    </li>
  );
}

/** 1 a 5 bolinhas acesas (5 = a maior rivalidade do país). */
function Intensity({ value, label }: { value: number; label: string }) {
  return (
    <span className="gs-intensity" role="img" aria-label={label} title={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} data-on={n <= value || undefined} />
      ))}
    </span>
  );
}

/**
 * Vitórias de cada lado (mandante à esquerda) e empates: o histórico geral curado quando há; senão, o
 * recorte da base. Sem os dois times do jogo na resposta, nada aparece.
 */
function DerbyHistory({
  eventId,
  homeId,
  awayId,
}: {
  eventId: string;
  homeId: string | undefined;
  awayId: string | undefined;
}) {
  const { texts } = useGalaxieWidget();
  const t = texts.h2h;
  const query = useGalaxieQuery<GsHeadToHead>(
    `/v1/events/${encodeURIComponent(eventId)}/h2h`,
    { limit: 1 },
    () => DETAIL_REFRESH_MS,
  );
  const h2h = query.data;
  if (!h2h) return null;
  const a = h2h.participants.find((p) => p.id === homeId);
  const b = h2h.participants.find((p) => p.id === awayId);
  const all = h2h.all_time;
  const total = all ? all.matches : h2h.summary.played;
  if (!a || !b || total === 0) return null;
  const draws = all ? all.draws : h2h.summary.draws;
  const winsOf = (id: string) => (all ? all.teams : h2h.summary.teams).find((x) => x.id === id)?.wins ?? 0;
  const winsA = winsOf(a.id);
  const winsB = winsOf(b.id);
  const pct = (n: number) => `${(n / total) * 100}%`;
  const caption = all
    ? fillText(t.allTime, { n: all.matches })
    : h2h.summary.since
      ? fillText(t.since, { n: h2h.summary.played, year: h2h.summary.since })
      : fillText(t.played, { n: h2h.summary.played });
  const summary = `${a.name} ${winsA} · ${t.draws} ${draws} · ${b.name} ${winsB}`;
  return (
    <div className="gs-derby-history" data-gs-history="">
      <div className="gs-bar" role="img" aria-label={summary}>
        <span data-part="home" style={{ width: pct(winsA) }} />
        <span data-part="draw" style={{ width: pct(draws) }} />
        <span data-part="away" style={{ width: pct(winsB) }} />
      </div>
      <span className="gs-meta">
        <strong>{`${a.name} ${winsA}`}</strong>
        {` · ${fillText(texts.derbies.draws, { n: draws })} · `}
        <strong>{`${winsB} ${b.name}`}</strong>
        {` · ${caption}`}
      </span>
    </div>
  );
}

/** Canais e streamings do jogo no país do widget (os confirmados; senão, os detentores a confirmar). */
function DerbyWatch({ eventId }: { eventId: string }) {
  const { texts, market, theme } = useGalaxieWidget();
  const query = useGalaxieQuery<GsWhereToWatch>(
    market ? `/v1/events/${encodeURIComponent(eventId)}/where-to-watch` : null,
    { country: market?.toUpperCase() },
    () => DETAIL_REFRESH_MS,
  );
  const data = query.data;
  if (!data) return null;
  const confirmed = data.options.length > 0;
  const seen = new Set<string>();
  const sources: (GsWatchOption | GsWatchToConfirm)[] = confirmed ? data.options : data.to_confirm;
  const items = sources
    .map((o): { name: string; logo: string | null } => ({
      name: ('channel' in o ? o.channel : null) ?? o.provider,
      logo: theme.mode === 'dark' ? (o.logo_dark ?? o.logo) : o.logo,
    }))
    .filter((o) => (seen.has(o.name) ? false : (seen.add(o.name), true)))
    .slice(0, MAX_CHANNELS);
  if (!items.length) return null;
  return (
    <div className="gs-line" data-gs-watch={confirmed ? 'confirmed' : 'to_confirm'}>
      <span className="gs-meta">{confirmed ? texts.whereToWatch : texts.toConfirm}</span>
      <ul className="gs-chips">
        {items.map((c) => (
          <li key={c.name} className="gs-chip" title={c.name}>
            <Crest src={c.logo} name={c.name} className="gs-logo" />
            <span className="gs-truncate">{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
