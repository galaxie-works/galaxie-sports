'use client';

import type { EventLineups, EventTimeline } from '@galaxie/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { fetchTimeline, timelineKey } from '@/lib/galaxie/live';
import type { ContentLocale } from '@/lib/i18n/config';
import type { LineupTab } from '@/lib/match-details';
import { lineupMarks } from '@/lib/lineup-marks';

import { LineupBench, LineupPitch, LineupStarters, type LineupDictionary } from './lineups';

/**
 * Escalação (titulares, reservas ou campo) com os gols, cartões e trocas do minuto a minuto ao vivo. Lê a
 * mesma query do `MatchTimeline` (`timelineKey`), sem buscar sozinha: quando o minuto a minuto se atualiza,
 * as marcas do campo e do banco mudam junto, sem recarregar a página. Sem minuto a minuto na tela, fica
 * no `timeline` do servidor.
 */
export function LiveLineup({
  view,
  eventId,
  timeline,
  lineups,
  colors,
  content,
  t,
}: {
  view: LineupTab;
  eventId: string;
  /** Minuto a minuto do servidor (o mesmo `initial` do `MatchTimeline`); null = sem marcas. */
  timeline: EventTimeline | null;
  lineups: EventLineups;
  colors: [string, string];
  content: ContentLocale;
  t: LineupDictionary;
}) {
  const q = useQuery({
    queryKey: timelineKey(eventId),
    // igual ao do MatchTimeline, que é quem busca: aqui a query só é lida
    queryFn: () => fetchTimeline(eventId, content),
    enabled: false,
    initialData: timeline ?? undefined,
    initialDataUpdatedAt: timeline ? Date.parse(timeline.generated_at) : undefined,
  });
  const marks = useMemo(() => lineupMarks(q.data ?? timeline), [q.data, timeline]);
  const props = { lineups, colors, marks, t };
  if (view === 'reservas') return <LineupBench {...props} />;
  if (view === 'campo') return <LineupPitch {...props} />;
  return <LineupStarters {...props} />;
}
