// Dados de exemplo da grade nos canais do cliente (`/v1/widgets/{id}/channel-guide`) para a prévia do Builder:
// os jogos de exemplo do esporte, cada um em canais fictícios de uma operadora.
import type { GsChannelGuide, GsEvent } from './core/model.js';

/** Canais fictícios da lista de exemplo (em ordem alfabética, como a API devolve). */
export const PREVIEW_CHANNELS = [
  'Canal Aberto HD',
  'Esporte Total 1',
  'Esporte Total 2',
  'Play Esportes',
] as const;

const PICKS: readonly (readonly string[])[] = [
  ['Canal Aberto HD', 'Play Esportes'],
  ['Esporte Total 1'],
  ['Esporte Total 2', 'Play Esportes'],
  ['Esporte Total 1', 'Play Esportes'],
];

/** Corpo de `/v1/widgets/{id}/channel-guide` com os jogos de exemplo, ou null se a rota é outra. */
export function channelGuidePreviewBody(url: URL, events: readonly GsEvent[]): GsChannelGuide | null {
  const m = /\/v1\/widgets\/([^/]+)\/channel-guide$/.exec(url.pathname.replace(/\/+$/, ''));
  if (!m) return null;
  const sports = url.searchParams.get('sport')?.split(',').filter(Boolean) ?? [];
  const date = url.searchParams.get('date') ?? events[0]?.starts_at.slice(0, 10) ?? '';
  const entries = events
    .filter((e) => !sports.length || sports.includes(e.sport))
    .map((event, i) => ({ event, channels: [...PICKS[i % PICKS.length]!] }))
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
  const used = new Set(entries.flatMap((e) => e.channels));
  return {
    widget_id: decodeURIComponent(m[1]!),
    date,
    country: 'BR',
    status: 'ok',
    channels: PREVIEW_CHANNELS.filter((c) => used.has(c)),
    entries,
  };
}
