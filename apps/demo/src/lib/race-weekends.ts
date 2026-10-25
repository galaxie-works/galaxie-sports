/**
 * Fins de semana de corrida (F1) a partir das sessões da temporada: cada Grande Prêmio é a fase (`stage`)
 * e cada sessão (treinos, classificação, sprint, corrida) é um evento. Dá o calendário e o próximo GP do
 * hub do campeonato.
 */
import type { Event } from '@galaxie/contracts';

/** Status que não mudam mais (mesmo conjunto de TERMINAL_STATUSES em @galaxie/providers). */
const TERMINAL = new Set(['finished', 'postponed', 'cancelled', 'abandoned']);
const LIVE = new Set(['starting', 'live', 'break', 'suspended']);

export type WeekendState = 'done' | 'live' | 'next' | 'upcoming';

export interface RaceWeekend {
  /** Nome do GP ("Bahrain Grand Prix"); sem fase, o nome da sessão. */
  name: string;
  /** Etapa na temporada (1 = primeiro GP). */
  round: number;
  /** Sessões em ordem de horário. */
  sessions: Event[];
  /** A corrida principal; sem ela (ainda não sincronizada), a última sessão. */
  main: Event;
  start: string;
  end: string;
  state: WeekendState;
}

const isRace = (e: Event) => e.session?.type === 'race';

/** Agrupa as sessões por GP, na ordem do calendário, e marca o estado de cada um. */
export function raceWeekends(events: Event[]): RaceWeekend[] {
  const byStage = new Map<string, Event[]>();
  for (const e of [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const name = e.stage?.name ?? e.session?.name ?? e.id;
    byStage.set(name, [...(byStage.get(name) ?? []), e]);
  }
  let nextTaken = false;
  return [...byStage].map(([name, sessions], i) => {
    const done = sessions.every((s) => TERMINAL.has(s.status));
    const live = sessions.some((s) => LIVE.has(s.status));
    let state: WeekendState = done ? 'done' : live ? 'live' : 'upcoming';
    // o primeiro GP ainda por terminar é o "próximo" (ou o que está rolando)
    if (!done && !nextTaken) {
      nextTaken = true;
      if (!live) state = 'next';
    }
    return {
      name,
      round: i + 1,
      sessions,
      main: sessions.find(isRace) ?? sessions.at(-1)!,
      start: sessions[0]!.starts_at,
      end: sessions.at(-1)!.starts_at,
      state,
    };
  });
}

/** Por que o GP está em destaque: pedido na URL (`?rodada=`), o próximo (ou em andamento) ou o último. */
export type FeaturedKind = 'focus' | 'next' | 'last';

/**
 * GP em destaque no hub: o pedido na URL (o "GP" da trilha de uma sessão leva de volta a ele); senão, o
 * que está rolando ou o próximo; com a temporada toda corrida (ou sem GP agendado nos dados), o último.
 */
export function featuredWeekend(
  weekends: RaceWeekend[],
  focus?: string | null,
): { weekend: RaceWeekend; kind: FeaturedKind } | null {
  const focused = focus ? weekends.find((w) => w.name === focus) : undefined;
  if (focused) return { weekend: focused, kind: 'focus' };
  const current = weekends.find((w) => w.state === 'live' || w.state === 'next');
  if (current) return { weekend: current, kind: 'next' };
  const last = weekends.at(-1);
  return last ? { weekend: last, kind: 'last' } : null;
}

/** Vencedor da corrida (posição 1 no grid), quando o resultado já chegou. */
export function raceWinner(weekend: RaceWeekend) {
  if (!isRace(weekend.main) || weekend.main.status !== 'finished') return null;
  return weekend.main.participants.find((p) => p.side === 'grid' && p.position === 1) ?? null;
}
