'use client';

import { useEffect, useState } from 'react';
import {
  LIVE_STATUSES,
  PROBLEM_STATUSES,
  STARTED_STATUSES,
  countdownParts,
  eventRefreshMs,
  sidesOf,
  type GsEvent,
  type GsWhereToWatch,
} from '../core/model.js';
import {
  Crest,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface CountdownProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
  /** Canais onde o jogo passa, embaixo da contagem (padrão: sim). */
  showWatch?: boolean | undefined;
  /** Segundos na contagem (padrão: sim). Sem eles, a contagem anda de minuto em minuto. */
  showSeconds?: boolean | undefined;
  /** O que fazer quando o jogo começa: virar o placar ao vivo (`score`, padrão) ou sumir (`hide`). */
  onStart?: 'score' | 'hide' | undefined;
}

const enc = encodeURIComponent;
/** Onde assistir muda devagar: de 5 em 5 minutos basta para pegar o canal confirmado. */
const WATCH_REFRESH_MS = 5 * 60_000;

/**
 * Contagem regressiva para o jogo: dias, horas, minutos e segundos até o início, com os escudos, o
 * campeonato e onde assistir. Quando o jogo começa, vira o placar ao vivo (ou some, se assim configurado).
 */
export function Countdown({
  eventId,
  showWatch = true,
  showSeconds = true,
  onStart = 'score',
}: CountdownProps) {
  const { texts, market, theme } = useGalaxieWidget();
  const fmt = useFormatters();
  const query = useGalaxieQuery<GsEvent>(eventId ? `/v1/events/${enc(eventId)}` : null, {}, (event) =>
    eventRefreshMs(event),
  );
  const event = query.data;
  const started = event ? STARTED_STATUSES.has(event.status) : false;
  const waiting = !!event && !started && !PROBLEM_STATUSES.has(event.status);
  const watch = useGalaxieQuery<GsWhereToWatch>(
    event && waiting && showWatch && market ? `/v1/events/${enc(event.id)}/where-to-watch` : null,
    { country: market },
    // o canal sai mais perto do jogo ("a confirmar" vira o canal): reconsulta enquanto a contagem está na tela
    () => WATCH_REFRESH_MS,
  );

  // relógio local: de segundo em segundo, ou na virada de cada minuto sem os segundos
  const [now, setNow] = useState(() => Date.now());
  const startsAt = event ? Date.parse(event.starts_at) : Number.NaN;
  const remaining = Number.isFinite(startsAt) ? startsAt - now : null;
  useEffect(() => {
    if (!waiting || remaining === null || remaining <= 0) return;
    // a contagem arredonda para cima: troca de número quando `remaining` cruza um segundo (ou minuto) cheio
    const step = showSeconds ? 1000 : 60_000;
    const timer = setTimeout(() => setNow(Date.now()), (remaining % step || step) + 5);
    return () => clearTimeout(timer);
  }, [waiting, remaining, showSeconds]);

  if (!event) {
    return (
      <WidgetFrame kind="countdown" busy={query.loading}>
        {query.loading ? (
          <LoadingState lines={3} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }
  if (started && onStart === 'hide') return null;

  const { home, away } = sidesOf(event);
  const { score } = event;
  const live = LIVE_STATUSES.has(event.status);
  // MMA: sem placar (home/away nulos); depois da luta, o método no meio, como no placar do jogo
  const hasScore = score.home !== null || score.away !== null;
  const fightResult = event.fight?.result && event.status === 'finished' ? event.fight.result : null;
  const competition = event.competition;
  const title = event.fight?.card?.name ?? competition?.name ?? '';
  const parts =
    waiting && remaining !== null && remaining > 0 ? countdownParts(remaining, showSeconds) : null;
  const units = parts
    ? ([
        ...(parts.days > 0 ? [['d', parts.days, texts.countdown.units.d] as const] : []),
        ['h', parts.hours, texts.countdown.units.h] as const,
        ['m', parts.minutes, texts.countdown.units.m] as const,
        ...(showSeconds ? [['s', parts.seconds, texts.countdown.units.s] as const] : []),
      ] as const)
    : [];
  const dark = theme.mode === 'dark';
  const channels = dedupeChannels(watch.data);
  const toConfirm =
    !!watch.data &&
    channels.length === 0 &&
    (watch.data.to_confirm.length > 0 || watch.data.availability?.channel_status === 'to_confirm');

  return (
    <WidgetFrame kind="countdown">
      <header className="gs-header">
        {competition ? <Crest src={competition.logo} name={competition.name} size="sm" /> : null}
        <span className="gs-truncate">{title}</span>
        <span className="gs-spacer" />
        {waiting ? <span>{fmt.dateTime(event.starts_at)}</span> : <StatusBadge event={event} />}
      </header>
      <div className="gs-match">
        <div
          className="gs-team"
          data-lost={(started && home?.winner === false) || undefined}
          data-won={(event.fight && home?.winner === true) || undefined}
        >
          <Crest src={home?.logo} name={home?.name ?? '?'} />
          <span>{home?.short_name ?? home?.name}</span>
        </div>
        {started && hasScore ? (
          <div className="gs-score" data-live={live || undefined} aria-live={live ? 'polite' : undefined}>
            <span>
              {score.home ?? 0} – {score.away ?? 0}
            </span>
          </div>
        ) : fightResult ? (
          <span className="gs-versus" data-gs-fight="">
            <strong>{fightResult.method_name}</strong>
          </span>
        ) : (
          <span className="gs-versus">{texts.versus}</span>
        )}
        <div
          className="gs-team"
          data-lost={(started && away?.winner === false) || undefined}
          data-won={(event.fight && away?.winner === true) || undefined}
        >
          <Crest src={away?.logo} name={away?.name ?? '?'} />
          <span>{away?.short_name ?? away?.name}</span>
        </div>
      </div>
      {waiting ? (
        parts ? (
          <div className="gs-countdown" role="timer" aria-label={texts.countdown.startsIn}>
            <span className="gs-group-title">{texts.countdown.startsIn}</span>
            <div className="gs-countdown-units">
              {units.map(([key, value, label]) => (
                <span key={key} className="gs-countdown-unit" data-unit={key}>
                  <strong>{key === 'd' ? value : String(value).padStart(2, '0')}</strong>
                  <small>{label}</small>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="gs-countdown" data-gs-starting="">
            <span className="gs-badge" data-tone="live">
              <span className="gs-dot" aria-hidden="true" />
              {texts.countdown.starting}
            </span>
          </div>
        )
      ) : null}
      {waiting && showWatch && (channels.length > 0 || toConfirm) ? (
        <div className="gs-group" data-gs-countdown-watch="">
          <div className="gs-group-title">{texts.whereToWatch}</div>
          {channels.length > 0 ? (
            <ul className="gs-chips">
              {channels.map((c) => (
                <li key={c.key} className="gs-chip" title={c.name}>
                  <Crest src={dark ? (c.logoDark ?? c.logo) : c.logo} name={c.name} className="gs-logo" />
                  <span className="gs-truncate">{c.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="gs-meta">{texts.toConfirm}</span>
          )}
        </div>
      ) : null}
    </WidgetFrame>
  );
}

/** Um chip por emissora (a mesma emissora pode vir em mais de uma opção: TV e streaming, praças). */
function dedupeChannels(data: GsWhereToWatch | null) {
  const seen = new Map<string, { key: string; name: string; logo: string | null; logoDark: string | null }>();
  for (const o of data?.options ?? []) {
    const key = o.provider_id ?? o.provider;
    if (seen.has(key)) continue;
    seen.set(key, { key, name: o.channel ?? o.provider, logo: o.logo, logoDark: o.logo_dark });
  }
  return [...seen.values()];
}
