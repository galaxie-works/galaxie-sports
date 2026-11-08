import type {
  GsEvent,
  GsEventSidelined,
  GsSidelinedPlayer,
  GsSidelinedTeam,
  GsTeamSidelined,
} from './core/model.js';

/** Desfalques de exemplo do Builder (#830): dois por time, um com volta prevista e uma dúvida. */

const addDays = (now: Date, n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);

type Sample = Pick<GsSidelinedPlayer, 'status' | 'category' | 'reason' | 'reason_label' | 'number'> & {
  name: string;
  /** Dias até a volta (null = sem previsão). */
  back: number | null;
};

const SAMPLES: Sample[][] = [
  [
    {
      name: 'Rafael Moura',
      number: 9,
      status: 'out',
      category: 'injury',
      reason: 'Hamstring Injury',
      reason_label: 'Lesão na coxa (posterior)',
      back: 12,
    },
    {
      name: 'Lucas Pires',
      number: 5,
      status: 'out',
      category: 'suspension',
      reason: 'Yellow Cards',
      reason_label: 'Cartões amarelos',
      back: null,
    },
    {
      name: 'Diego Alves',
      number: 17,
      status: 'doubtful',
      category: 'injury',
      reason: 'Knock',
      reason_label: 'Pancada',
      back: null,
    },
  ],
  [
    {
      name: 'Bruno Costa',
      number: 3,
      status: 'out',
      category: 'injury',
      reason: 'Knee Injury',
      reason_label: 'Lesão no joelho',
      back: 40,
    },
    {
      name: 'Thiago Reis',
      number: 21,
      status: 'doubtful',
      category: 'illness',
      reason: 'Illness',
      reason_label: 'Doença',
      back: null,
    },
  ],
];

const players = (samples: Sample[], now: Date): GsSidelinedPlayer[] =>
  samples.map((s) => ({
    person: { id: null, name: s.name, photo: null },
    position: null,
    number: s.number,
    status: s.status,
    category: s.category,
    reason: s.reason,
    reason_label: s.reason_label,
    since: addDays(now, -6),
    until: s.back === null ? null : addDays(now, s.back),
    source: 'match',
  }));

/** `/v1/events/{id}/sidelined` de um jogo de exemplo (mandante primeiro). */
export function previewEventSidelined(e: GsEvent, now: Date): GsEventSidelined {
  const sides = ['home', 'away'] as const;
  return {
    event_id: e.id,
    available: true,
    teams: sides.map((side, i) => {
      const p = e.participants.find((x) => x.side === side);
      return {
        team: { id: p?.id ?? null, name: p?.name ?? null, side, logo: p?.logo ?? null },
        players: players(SAMPLES[i]!, now),
      };
    }),
  };
}

/** `/v1/teams/{id}/sidelined` do time de exemplo. */
export function previewTeamSidelined(team: GsSidelinedTeam, now: Date): GsTeamSidelined {
  return {
    team,
    as_of: now.toISOString().slice(0, 10),
    available: true,
    next_event_id: null,
    players: players(SAMPLES[0]!, now),
  };
}
