import type { Event } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { featuredWeekend, raceWeekends, raceWinner } from './race-weekends';

let seq = 0;
function session(
  gp: string,
  type: 'practice' | 'qualifying' | 'race',
  startsAt: string,
  status: Event['status'],
  winner?: string,
): Event {
  return {
    id: `e${++seq}`,
    stage: { kind: 'race_weekend', leg: null, name: gp },
    session: { type, number: type === 'practice' ? 1 : null, name: type, laps: null, distance: null },
    starts_at: startsAt,
    status,
    participants: winner
      ? [
          { side: 'grid', id: 'p2', name: 'Segundo', position: 2 },
          { side: 'grid', id: 'p1', name: winner, position: 1 },
        ]
      : [],
  } as unknown as Event;
}

describe('fins de semana de corrida', () => {
  const season = [
    session('Monaco Grand Prix', 'race', '2026-06-07T13:00:00Z', 'finished', 'Leclerc'),
    session('Monaco Grand Prix', 'practice', '2026-06-05T11:30:00Z', 'finished'),
    session('São Paulo Grand Prix', 'practice', '2026-11-06T14:30:00Z', 'scheduled'),
    session('São Paulo Grand Prix', 'race', '2026-11-08T17:00:00Z', 'scheduled'),
    session('Las Vegas Grand Prix', 'race', '2026-11-22T04:00:00Z', 'scheduled'),
  ];

  it('agrupa as sessões por GP, na ordem do calendário, com a corrida como principal', () => {
    const weekends = raceWeekends(season);
    expect(weekends.map((w) => [w.round, w.name, w.state])).toEqual([
      [1, 'Monaco Grand Prix', 'done'],
      [2, 'São Paulo Grand Prix', 'next'],
      [3, 'Las Vegas Grand Prix', 'upcoming'],
    ]);
    expect(weekends[0]!.sessions.map((s) => s.session?.type)).toEqual(['practice', 'race']);
    expect(weekends[0]!.main.session?.type).toBe('race');
    expect(weekends[0]!.start).toBe('2026-06-05T11:30:00Z');
  });

  it('vencedor só com a corrida encerrada', () => {
    const [monaco, saoPaulo] = raceWeekends(season);
    expect(raceWinner(monaco!)?.name).toBe('Leclerc');
    expect(raceWinner(saoPaulo!)).toBeNull();
  });

  it('GP em andamento é "ao vivo", e o seguinte não vira "próximo"', () => {
    const live = [
      session('Abu Dhabi Grand Prix', 'race', '2026-12-06T13:00:00Z', 'live'),
      session('Fim', 'race', '2026-12-13T13:00:00Z', 'scheduled'),
    ];
    expect(raceWeekends(live).map((w) => w.state)).toEqual(['live', 'upcoming']);
  });

  it('destaque: o GP pedido na URL, senão o próximo, senão o último', () => {
    const weekends = raceWeekends(season);
    expect(featuredWeekend(weekends, 'Monaco Grand Prix')).toMatchObject({
      kind: 'focus',
      weekend: { name: 'Monaco Grand Prix' },
    });
    expect(featuredWeekend(weekends, 'GP que não existe')).toMatchObject({
      kind: 'next',
      weekend: { name: 'São Paulo Grand Prix' },
    });
    expect(featuredWeekend(raceWeekends(season.slice(0, 2)))).toMatchObject({
      kind: 'last',
      weekend: { name: 'Monaco Grand Prix' },
    });
    expect(featuredWeekend([])).toBeNull();
  });
});
