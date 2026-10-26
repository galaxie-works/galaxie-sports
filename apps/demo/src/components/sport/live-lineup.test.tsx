import type { EventLineups, EventTimeline } from '@galaxie/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { timelineKey } from '@/lib/galaxie/live';
import { getDictionary } from '@/lib/i18n/dictionary';

import { lineupDictionary } from './lineups';
import { LiveLineup } from './live-lineup';

const EVENT = '0199a5c0-0000-7000-8000-0000000000e1';
const t = lineupDictionary(getDictionary('pt-BR'));
const hercules = { id: 'p-hercules', name: 'Hércules', photo: null };

const lineups = {
  event_id: EVENT,
  available: true,
  lineups: [
    {
      team: { id: 't-home', name: 'Mandante', logo: null, side: 'home' },
      formation: '4-3-3',
      coach: null,
      start_xi: [{ person: hercules, number: 8, position: 'M', grid: null }],
      substitutes: [],
    },
    {
      team: { id: 't-away', name: 'Visitante', logo: null, side: 'away' },
      formation: '4-4-2',
      coach: null,
      start_xi: [],
      substitutes: [],
    },
  ],
} as unknown as EventLineups;

/** Minuto a minuto com os gols do Hércules nos minutos dados. */
const timeline = (goals: string[]): EventTimeline =>
  ({
    event_id: EVENT,
    live: true,
    generated_at: '2026-10-25T18:00:00Z',
    incidents: goals.map((display, i) => ({
      sequence: i + 1,
      kind: 'goal',
      clock: { period: 'second_half', minute: Number.parseInt(display), extra_minute: null, display },
      player: hercules,
      assist: null,
      player_in: null,
      player_out: null,
    })),
  }) as unknown as EventTimeline;

function render(client: QueryClient, initial: EventTimeline | null) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LiveLineup
        view="titulares"
        eventId={EVENT}
        timeline={initial}
        lineups={lineups}
        colors={['#01713d', '#900028']}
        content="pt-BR"
        t={t}
      />
    </QueryClientProvider>,
  );
}

describe('LiveLineup', () => {
  it('sem atualização ao vivo, as marcas vêm do minuto a minuto do servidor', () => {
    const html = render(new QueryClient(), timeline(["12'"]));
    expect(html).toContain('Gol aos 12&#x27;');
  });

  it('o minuto a minuto ao vivo (mesma query do MatchTimeline) atualiza as marcas da escalação', () => {
    const client = new QueryClient();
    // o MatchTimeline já buscou de novo: saiu outro gol depois do snapshot da página
    client.setQueryData(timelineKey(EVENT), timeline(["12'", "80'"]));
    const html = render(client, timeline(["12'"]));
    expect(html).toContain('Gol aos 12&#x27; · Gol aos 80&#x27;');
  });

  it('sem minuto a minuto, sem marcas', () => {
    expect(render(new QueryClient(), null)).not.toContain('Gol aos');
  });
});
