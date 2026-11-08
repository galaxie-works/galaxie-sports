// Chaveamento de exemplo (#829) para a prévia do Builder e os testes: a "Copa Exemplo", com nomes fictícios.
// Segue o contrato completo da API (@galaxie/contracts): se ele mudar, o typecheck daqui acusa.
import type { Bracket, BracketTie } from '@galaxie/contracts';

export const BRACKET_IDS = { competition: 'copa-exemplo' } as const;

const COMPETITION_ID = '0199a5c0-0000-7000-8000-0000000000c2';
const DAY_MS = 86_400_000;

/** Esportes em que o exemplo sai como série melhor de 7 (playoffs). */
const SERIES = new Set(['basketball', 'nba', 'baseball', 'hockey', 'volleyball']);

function shield(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 4 6v9c0 7.5 5.1 13 12 15 6.9-2 12-7.5 12-15V6z" fill="${color}"/><path d="M16 7 9 9.5V15c0 4.6 3 8 7 9.5 4-1.5 7-4.9 7-9.5V9.5z" fill="#fff" fill-opacity=".85"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TEAMS = [
  ['Clube Aurora', 'Aurora', '#1d4ed8'],
  ['Estrela do Sul', 'Estrela', '#dc2626'],
  ['Atlético Serra', 'Serra', '#15803d'],
  ['União Litoral', 'Litoral', '#0891b2'],
  ['Real Planalto', 'Planalto', '#7c3aed'],
  ['Sporting Vale', 'Vale', '#ca8a04'],
  ['Esporte Clube Cerrado', 'Cerrado', '#ea580c'],
  ['Associação Pampa', 'Pampa', '#475569'],
].map(([name, short, color], i) => ({
  id: `0199a5c0-0000-7000-8000-0000000000b${i + 1}`,
  name: name!,
  provider_name: name!,
  short_name: short!,
  logo: shield(color!),
}));
const [aurora, estrela, serra, litoral, planalto, vale, cerrado, pampa] = TEAMS as [
  (typeof TEAMS)[number],
  (typeof TEAMS)[number],
  (typeof TEAMS)[number],
  (typeof TEAMS)[number],
  (typeof TEAMS)[number],
  (typeof TEAMS)[number],
  (typeof TEAMS)[number],
  (typeof TEAMS)[number],
];
type Team = (typeof TEAMS)[number];

let seq = 0;
const eventId = () => `0199a5c0-0000-7000-8000-00000000d${String(++seq).padStart(3, '0')}`;

/** Ida e volta (futebol): placares de cada jogo do ponto de vista do mandante daquele jogo. */
function twoLegs(
  now: Date,
  home: Team,
  away: Team,
  days: [number, number],
  legs: ([number, number] | null)[],
  penalty: [number, number] | null = null,
): BracketTie {
  const at = (d: number) => new Date(now.getTime() + d * DAY_MS).toISOString();
  const played = legs.filter((l): l is [number, number] => !!l);
  const agg = played.reduce(
    (acc, l, i) =>
      i === 0
        ? { home: acc.home + l[0], away: acc.away + l[1] }
        : { home: acc.home + l[1], away: acc.away + l[0] },
    { home: 0, away: 0 },
  );
  const decided = played.length === 2;
  const pens = penalty ? { home: penalty[1], away: penalty[0] } : null;
  const winner = !decided
    ? null
    : agg.home !== agg.away
      ? agg.home > agg.away
        ? home.id
        : away.id
      : pens && pens.home > pens.away
        ? home.id
        : away.id;
  return {
    id: `${home.id}|${away.id}`,
    home,
    away,
    format: 'two_legs',
    legs: legs.map((l, i) => ({
      event_id: eventId(),
      leg: i + 1,
      starts_at: at(days[i]!),
      status: l ? 'finished' : 'scheduled',
      home_id: i === 0 ? home.id : away.id,
      score: { home: l?.[0] ?? null, away: l?.[1] ?? null },
      penalty: i === 1 && penalty ? { home: penalty[0], away: penalty[1] } : null,
    })),
    aggregate: played.length ? agg : null,
    wins: null,
    penalties: decided ? pens : null,
    winner_id: winner,
    status: decided ? 'decided' : played.length ? 'in_progress' : 'scheduled',
  };
}

/** Série melhor de 7: vitórias de cada lado e os jogos (só o placar de quem venceu cada um importa). */
function series(now: Date, home: Team, away: Team, start: number, wins: [number, number]): BracketTie {
  const games = wins[0] + wins[1];
  const decided = Math.max(...wins) >= 4;
  // os primeiros jogos para quem lidera, alternando o mando (2 em casa, 2 fora)
  const homeWon = Array.from({ length: games }, (_, i) =>
    i % 2 === 0 ? i / 2 < wins[0] : (i - 1) / 2 >= wins[1],
  );
  return {
    id: `${home.id}|${away.id}`,
    home,
    away,
    format: 'series',
    legs: [
      ...homeWon.map((won, i) => {
        const tieHomeAtHome = i % 4 < 2;
        const legHomeWon = won === tieHomeAtHome;
        return {
          event_id: eventId(),
          leg: i + 1,
          starts_at: new Date(now.getTime() + (start + i * 2) * DAY_MS).toISOString(),
          status: 'finished' as const,
          home_id: tieHomeAtHome ? home.id : away.id,
          score: legHomeWon ? { home: 104, away: 97 } : { home: 95, away: 101 },
          penalty: null,
        };
      }),
      ...(decided
        ? []
        : [
            {
              event_id: eventId(),
              leg: games + 1,
              starts_at: new Date(now.getTime() + 2 * DAY_MS).toISOString(),
              status: 'scheduled' as const,
              home_id: home.id,
              score: { home: null, away: null },
              penalty: null,
            },
          ]),
    ],
    aggregate: null,
    wins: { home: wins[0], away: wins[1] },
    penalties: null,
    winner_id: decided ? (wins[0] > wins[1] ? home.id : away.id) : null,
    status: decided ? 'decided' : 'in_progress',
  };
}

/**
 * Quartas decididas (uma nos pênaltis), uma semifinal decidida e a outra com a ida jogada, e a final por
 * jogar. Nos esportes de série, as mesmas fases com séries melhor de 7.
 */
export function createBracketFixture(now: Date, sport?: string): Bracket {
  seq = 0;
  const isSeries = !!sport && SERIES.has(sport);
  const tie = (
    h: Team,
    a: Team,
    d: [number, number],
    legs: ([number, number] | null)[],
    pen?: [number, number],
  ) => {
    const twoLegged = twoLegs(now, h, a, d, legs, pen ?? null);
    if (!isSeries) return twoLegged;
    // série: quem passou na ida e volta vence a série (4×2, ou 4×3 se foi aos pênaltis); em aberto, 2×1
    if (legs[1] === null) return series(now, h, a, d[0], [2, 1]);
    const loser = pen ? 3 : 2;
    return series(now, h, a, d[0], twoLegged.winner_id === h.id ? [4, loser] : [loser, 4]);
  };
  const final: BracketTie = isSeries
    ? series(now, aurora, cerrado, 6, [0, 0])
    : {
        id: `${aurora.id}|final`,
        home: aurora,
        away: null,
        format: 'single',
        legs: [],
        aggregate: null,
        wins: null,
        penalties: null,
        winner_id: null,
        status: 'scheduled',
      };
  return {
    competition_id: COMPETITION_ID,
    sport: sport ?? 'football',
    season: { year: now.getUTCFullYear(), label: String(now.getUTCFullYear()) },
    rounds: [
      {
        stage_id: '0199a5c0-0000-7000-8000-0000000000f1',
        kind: 'quarter_final',
        name: 'Quartas de final',
        ties: [
          tie(
            aurora,
            pampa,
            [-28, -21],
            [
              [2, 0],
              [1, 1],
            ],
          ),
          tie(
            litoral,
            serra,
            [-28, -21],
            [
              [1, 2],
              [1, 0],
            ],
          ),
          tie(
            cerrado,
            estrela,
            [-27, -20],
            [
              [1, 1],
              [0, 0],
            ],
            [3, 4],
          ),
          tie(
            vale,
            planalto,
            [-27, -20],
            [
              [0, 1],
              [1, 3],
            ],
          ),
        ],
      },
      {
        stage_id: '0199a5c0-0000-7000-8000-0000000000f2',
        kind: 'semi_final',
        name: 'Semifinal',
        ties: [
          tie(
            serra,
            aurora,
            [-10, -3],
            [
              [1, 1],
              [2, 0],
            ],
          ),
          tie(vale, cerrado, [-2, 3], [[0, 2], null]),
        ],
      },
      {
        stage_id: '0199a5c0-0000-7000-8000-0000000000f3',
        kind: 'final',
        name: 'Final',
        ties: [final],
      },
    ],
    updated_at: now.toISOString(),
  };
}
