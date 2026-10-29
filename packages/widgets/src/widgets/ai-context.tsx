'use client';

import { useState } from 'react';

import { STARTED_STATUSES, sidesOf, type GsEvent, type GsEventContext } from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface AiContextProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
  /**
   * `scenario` (antes do jogo), `recap` (depois) ou `auto` (padrão): o resumo quando o jogo já começou
   * e saiu, senão o cenário; com os dois prontos, o torcedor alterna entre eles.
   */
  show?: 'auto' | 'scenario' | 'recap' | undefined;
}

/** O texto muda poucas vezes por jogo (cenário de véspera, resumo depois do apito): 5 minutos. */
const CONTEXT_REFRESH_MS = 5 * 60_000;

/** Contexto de IA do jogo: o cenário antes da partida e o resumo depois, no idioma do widget. */
export function AiContext({ eventId, show = 'auto' }: AiContextProps) {
  const { texts } = useGalaxieWidget();
  const t = texts.context;
  const path = eventId ? `/v1/events/${encodeURIComponent(eventId)}` : null;
  const event = useGalaxieQuery<GsEvent>(path, {}, () => CONTEXT_REFRESH_MS);
  const context = useGalaxieQuery<GsEventContext>(path && `${path}/context`, {}, () => CONTEXT_REFRESH_MS);
  const [picked, setPicked] = useState<'scenario' | 'recap' | null>(null);

  if (!context.data) {
    return (
      <WidgetFrame kind="ai_context" busy={context.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {context.loading ? (
          <LoadingState lines={4} />
        ) : (
          <ErrorState error={context.error} onRetry={context.retry} />
        )}
      </WidgetFrame>
    );
  }

  const scenario = context.data.data.find((c) => c.kind === 'scenario') ?? null;
  const recap = context.data.data.find((c) => c.kind === 'recap') ?? null;
  const started = event.data ? STARTED_STATUSES.has(event.data.status) : Boolean(recap);
  const preferred = show === 'auto' ? (started && recap ? 'recap' : 'scenario') : show;
  const kind = show === 'auto' && picked ? picked : preferred;
  const current = kind === 'recap' ? recap : scenario;
  const both = show === 'auto' && scenario && recap;
  const { home, away } = event.data ? sidesOf(event.data) : { home: undefined, away: undefined };

  return (
    <WidgetFrame kind="ai_context">
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
        <span className="gs-spacer" />
        {both ? (
          <span className="gs-seg" role="group" aria-label={t.title}>
            {(['scenario', 'recap'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setPicked(k)}>
                {t[k]}
              </button>
            ))}
          </span>
        ) : current ? (
          <span className="gs-badge">{t[current.kind]}</span>
        ) : null}
      </header>
      {home && away && event.data ? (
        <div className="gs-line">
          <Crest src={home.logo} name={home.name} size="sm" />
          <span className="gs-truncate">
            {home.short_name ?? home.name} {texts.versus} {away.short_name ?? away.name}
          </span>
          <Crest src={away.logo} name={away.name} size="sm" />
          <span className="gs-spacer" />
          <StatusBadge event={event.data} />
        </div>
      ) : null}
      {current ? (
        <>
          <p className="gs-prose" aria-live="polite">
            {current.text}
          </p>
          {current.origin === 'llm' ? <span className="gs-muted gs-small">{t.aiNote}</span> : null}
        </>
      ) : (
        <EmptyState>{t.empty}</EmptyState>
      )}
    </WidgetFrame>
  );
}
