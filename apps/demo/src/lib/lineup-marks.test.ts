import type { EventTimeline, TimelineIncident } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { lineupMarks, pitchRows, shortName } from './lineup-marks';

const person = (id: string, name: string) => ({ id, name, photo: null, number: null, position: null });

let seq = 0;
function incident(kind: TimelineIncident['kind'], display: string, extra: Partial<TimelineIncident> = {}) {
  seq += 1;
  return {
    sequence: seq,
    kind,
    clock: { period: 'second_half', minute: Number.parseInt(display), extra_minute: null, display },
    player: null,
    assist: null,
    player_in: null,
    player_out: null,
    ...extra,
  } as unknown as TimelineIncident;
}

const hercules = person('p-hercules', 'Hércules Pereira do Nascimento');
const wesley = person('p-wesley', 'Wesley Natã de Freitas Prado');
const lopez = person('p-lopez', 'J. López');
const sosa = person('p-sosa', 'R. Sosa');
const barboza = person('p-barboza', 'A. Barboza');

/** Recorte do Palmeiras x Fluminense (semifinal da Libertadores 2026). */
const timeline = {
  incidents: [
    incident('yellow_card', "49'", { player: barboza }),
    incident('yellow_card', "56'", { player: hercules }),
    // na substituição o fornecedor repete quem entra em `assist`: não é assistência
    incident('substitution', "62'", { player: lopez, assist: sosa, player_in: sosa, player_out: lopez }),
    incident('goal', "82'", { player: hercules, assist: wesley }),
    incident('second_yellow', "88'", { player: barboza }),
    incident('shootout_scored', '', {
      player: hercules,
      clock: { period: 'penalty_shootout', minute: null, extra_minute: null, display: '' },
    } as Partial<TimelineIncident>),
  ],
} as unknown as EventTimeline;

describe('lineupMarks', () => {
  const marks = lineupMarks(timeline);

  it('gol com assistência, cartões e substituição, com o minuto', () => {
    expect(marks(hercules)).toMatchObject({ goals: ["82'"], yellow: "56'", red: null });
    expect(marks(wesley)).toMatchObject({ assists: ["82'"], goals: [] });
    expect(marks(lopez)).toMatchObject({ subOut: "62'", subIn: null });
    expect(marks(sosa)).toMatchObject({ subIn: "62'", assists: [] });
    expect(marks(barboza)).toMatchObject({ yellow: "49'", secondYellow: "88'" });
  });

  it('a disputa de pênaltis não conta gol', () => {
    expect(marks(hercules)?.goals).toHaveLength(1);
  });

  it('sem lance, sem marca; sem ID, casa pelo nome', () => {
    expect(marks({ id: 'p-outro', name: 'Fábio' })).toBeNull();
    const byName = lineupMarks({
      incidents: [incident('goal', "10'", { player: { ...hercules, id: null } })],
    } as unknown as EventTimeline);
    expect(byName({ id: null, name: 'hércules pereira do nascimento' })?.goals).toEqual(["10'"]);
    expect(lineupMarks(null)(hercules)).toBeNull();
  });
});

describe('campo', () => {
  it('linhas pelo grid, colunas em ordem; sem grid fica de fora', () => {
    const rows = pitchRows([
      { grid: '2:2', n: 15 },
      { grid: '1:1', n: 1 },
      { grid: '2:1', n: 2 },
      { grid: '2:3', n: 26 },
      { grid: null, n: 14 },
    ]);
    expect(rows.map((r) => r.map((p) => p.n))).toEqual([[1], [2, 15, 26]]);
  });

  it('nome curto', () => {
    expect(shortName('Thiago Silva')).toBe('Thiago Silva');
    expect(shortName('J. López')).toBe('J. López');
    expect(shortName('Hércules Pereira do Nascimento')).toBe('Hércules');
  });
});
