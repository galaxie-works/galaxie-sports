'use client';

import { useState } from 'react';

import {
  durationText,
  fillText,
  safeEmbedUrl,
  safeImage,
  safeLink,
  type GsRelated,
  type GsRelatedItem,
} from '../core/model.js';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface RelatedVideosProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
  /** Máximo de vídeos (padrão 6). */
  limit?: number | undefined;
  /** `short` (verticais curtos) ou `long`. Padrão: os dois. */
  format?: 'short' | 'long' | undefined;
  /** Tipos separados por vírgula (ex.: `highlights,goal`). Padrão: todos. */
  types?: string | undefined;
}

/** Vídeos novos chegam nas horas depois do jogo: 10 minutos. */
const VIDEOS_REFRESH_MS = 10 * 60_000;

/**
 * Vídeos do jogo (melhores momentos, gols, entrevistas, reações) de canais oficiais, de detentores de
 * direitos e da imprensa, no idioma do país. O vídeo toca ali mesmo, no player oficial.
 */
export function RelatedVideos({ eventId, limit = 6, format, types }: RelatedVideosProps) {
  const { texts, market } = useGalaxieWidget();
  const t = texts.videos;
  const max = Math.min(Math.max(Math.round(limit) || 6, 1), 24);
  const query = useGalaxieQuery<GsRelated>(
    eventId ? `/v1/events/${encodeURIComponent(eventId)}/related` : null,
    { limit: max, format, type: types, country: market },
    () => VIDEOS_REFRESH_MS,
  );
  const [playing, setPlaying] = useState<GsRelatedItem | null>(null);

  if (!query.data) {
    return (
      <WidgetFrame kind="related_videos" busy={query.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {query.loading ? (
          <LoadingState lines={4} />
        ) : (
          <ErrorState error={query.error} onRetry={query.retry} />
        )}
      </WidgetFrame>
    );
  }

  const items = query.data.data.slice(0, max);
  const player = playing ? safeEmbedUrl(playing.embed_url) : null;

  return (
    <WidgetFrame kind="related_videos">
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
        <span className="gs-spacer" />
        {player ? (
          <button type="button" className="gs-button" onClick={() => setPlaying(null)}>
            {t.close}
          </button>
        ) : null}
      </header>
      {player && playing ? (
        <iframe
          className="gs-player"
          data-vertical={playing.aspect_ratio === '9:16' || undefined}
          src={`${player}${player.includes('?') ? '&' : '?'}autoplay=1&rel=0`}
          title={playing.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : null}
      {items.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <ul className="gs-videos">
          {items.map((item) => (
            <VideoTile
              key={item.id}
              item={item}
              label={fillText(t.play, { title: item.title })}
              onPlay={() => setPlaying(item)}
            />
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}

function VideoTile({ item, label, onPlay }: { item: GsRelatedItem; label: string; onPlay: () => void }) {
  const duration = durationText(item.duration_seconds);
  const thumb = safeImage(item.thumbnail_url);
  const inner = (
    <>
      {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" /> : null}
      <span className="gs-thumb-type">{item.content_type_label}</span>
      {duration ? <span className="gs-thumb-badge">{duration}</span> : null}
    </>
  );
  const href = safeLink(item.url);
  return (
    <li className="gs-video" data-gs-video={item.id}>
      {safeEmbedUrl(item.embed_url) ? (
        <button type="button" className="gs-thumb" aria-label={label} onClick={onPlay}>
          {inner}
        </button>
      ) : href ? (
        <a className="gs-thumb" href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
          {inner}
        </a>
      ) : (
        <span className="gs-thumb">{inner}</span>
      )}
      <span className="gs-clamp" title={item.title}>
        {item.title}
      </span>
      <span className="gs-muted gs-small gs-truncate">{item.channel.title}</span>
    </li>
  );
}
