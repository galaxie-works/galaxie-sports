// Dados de exemplo da F1 e do MMA (épico #731): um fim de semana de GP, o calendário, a classificação e a
// carreira de um piloto; um card de MMA e o cartel de um lutador. Nomes fictícios, relativos a `now`.
import type {
  GsCompetition,
  GsEvent,
  GsFightCard,
  GsParticipant,
  GsRaceCareer,
  GsStandings,
  GsTeam,
} from './core/model.js';

export const RACING_IDS = {
  raceCompetition: '0199a5c0-0000-7000-8000-0000000004c1',
  raceEvent: '0199a5c0-0000-7000-8000-000000000405',
  driver: '0199a5c0-0000-7000-8000-0000000004d1',
  fightCompetition: '0199a5c0-0000-7000-8000-0000000005c1',
  fightEvent: '0199a5c0-0000-7000-8000-000000000501',
  fighter: '0199a5c0-0000-7000-8000-0000000005f1',
} as const;

const RACE_SLUG = 'campeonato-exemplo-f1';
const FIGHT_SLUG = 'liga-exemplo-mma';

/** Retrato ou logo genérico (SVG em data URI) na cor da equipe. */
function badge(color: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><text x="16" y="21" font-family="sans-serif" font-size="12" font-weight="700" text-anchor="middle" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const RACE_TEAMS = [
  { id: '0199a5c0-0000-7000-8000-0000000004e1', name: 'Equipe Aurora', color: '#1d4ed8' },
  { id: '0199a5c0-0000-7000-8000-0000000004e2', name: 'Equipe Estrela', color: '#dc2626' },
  { id: '0199a5c0-0000-7000-8000-0000000004e3', name: 'Equipe Serra', color: '#15803d' },
  { id: '0199a5c0-0000-7000-8000-0000000004e4', name: 'Equipe Litoral', color: '#0891b2' },
] as const;

const DRIVERS = [
  ['Lucas Andrade', 0],
  ['Marco Bellini', 1],
  ['Tomás Ferreira', 0],
  ['Jonas Keller', 2],
  ['Rafael Duarte', 1],
  ['Hugo Martins', 3],
  ['Pedro Salles', 2],
  ['Enzo Moretti', 3],
] as const;

const driverId = (i: number) => (i === 0 ? RACING_IDS.driver : `0199a5c0-0000-7000-8000-0000000004d${i + 1}`);
const initialsOf = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('');

function raceCompetition(): NonNullable<GsEvent['competition']> {
  return { id: RACING_IDS.raceCompetition, slug: RACE_SLUG, name: 'Campeonato Exemplo de F1', logo: null };
}

const GAPS = ['1:32:14.208', '+3.412', '+8.905', '+15.330', '+22.871', '+31.004', '+45.612', '+1 volta'];

/** O grid de uma sessão encerrada, com a ordem girada por `shift` (cada GP tem um vencedor). */
function grid(shift: number, finished: boolean): GsParticipant[] {
  return DRIVERS.map(([name, team], i) => {
    const t = RACE_TEAMS[team]!;
    const position = ((i + shift) % DRIVERS.length) + 1;
    return {
      side: 'grid',
      id: driverId(i),
      name,
      short_name: null,
      logo: badge(t.color, initialsOf(name)),
      winner: finished ? position === 1 : null,
      position: finished ? position : null,
      result: finished
        ? {
            time: position === 1 ? GAPS[0]! : null,
            gap: position === 1 ? null : GAPS[position - 1]!,
            laps: 57,
            grid: ((i + shift + 2) % DRIVERS.length) + 1,
            pits: 1 + (i % 2),
            team: { id: t.id, name: t.name, logo: badge(t.color, t.name.split(' ')[1]![0]!) },
          }
        : null,
    };
  });
}

function session(
  id: string,
  gp: string,
  type: NonNullable<GsEvent['session']>['type'],
  name: string,
  startsAt: Date,
  status: GsEvent['status'],
  shift: number,
): GsEvent {
  const finished = status === 'finished';
  const participants = grid(shift, finished);
  const fastest = participants.find((p) => p.position === 3);
  return {
    id,
    sport: 'formula-1',
    competition: raceCompetition(),
    stage: { name: gp },
    starts_at: startsAt.toISOString(),
    status,
    clock: null,
    participants,
    score: { home: null, away: null, penalty: null },
    venue: { name: `Circuito ${gp.replace('GP ', '')}`, city: gp.replace('GP ', ''), timezone: null },
    session: {
      type,
      number: null,
      name,
      laps: type === 'race' ? 57 : null,
      distance: null,
      fastest_lap:
        finished && type === 'race' ? { participant_id: fastest?.id ?? null, time: '1:33.402' } : null,
    },
  };
}

const GPS = ['GP Exemplo', 'GP do Litoral', 'GP da Serra', 'GP do Vale', 'GP do Planalto', 'GP da Aurora'];

export interface RacingFixtures {
  competition: GsCompetition;
  /** As sessões do GP de exemplo e as corridas dos outros GPs da temporada. */
  events: GsEvent[];
  standings: GsStandings;
  driver: GsTeam;
  career: GsRaceCareer;
}

export function createRacingFixtures(now: Date): RacingFixtures {
  const days = (d: number, h = 0) => new Date(now.getTime() + d * 86_400_000 + h * 3_600_000);
  const year = now.getUTCFullYear();
  // o GP de exemplo terminou ontem (corrida), com os treinos e a classificação antes
  const weekend = [
    session(
      '0199a5c0-0000-7000-8000-000000000401',
      GPS[0]!,
      'practice',
      'Treino livre 1',
      days(-3, -2),
      'finished',
      3,
    ),
    session(
      '0199a5c0-0000-7000-8000-000000000402',
      GPS[0]!,
      'practice',
      'Treino livre 2',
      days(-3, 2),
      'finished',
      2,
    ),
    session(
      '0199a5c0-0000-7000-8000-000000000403',
      GPS[0]!,
      'qualifying',
      'Classificação',
      days(-2),
      'finished',
      1,
    ),
    session('0199a5c0-0000-7000-8000-000000000404', GPS[0]!, 'sprint', 'Sprint', days(-2, -4), 'finished', 1),
    session(RACING_IDS.raceEvent, GPS[0]!, 'race', 'Corrida', days(-1), 'finished', 0),
  ];
  // calendário: 2 GPs antes, o de exemplo e 3 pela frente
  const others = GPS.slice(1).map((gp, i) => {
    const offset = i < 2 ? -(i + 1) * 14 - 1 : (i - 1) * 14 - 1;
    return session(
      `0199a5c0-0000-7000-8000-0000000004${String(10 + i)}`,
      gp,
      'race',
      'Corrida',
      days(offset),
      offset < 0 ? 'finished' : 'scheduled',
      i + 1,
    );
  });
  const standingRows = DRIVERS.map(([name, team], i) => {
    const t = RACE_TEAMS[team]!;
    return {
      rank: i + 1,
      participant: { id: driverId(i), name, short_name: null, logo: badge(t.color, initialsOf(name)) },
      points: 180 - i * 19,
      played: 0,
      won: Math.max(0, 4 - i),
      drawn: 0,
      lost: 0,
      goal_diff: 0,
      form: null,
      description: null,
      podiums: Math.max(0, 8 - i * 2),
      season_team: { id: t.id, name: t.name, livery: { primary: t.color } },
    };
  });
  const constructors = RACE_TEAMS.map((t, i) => ({
    rank: i + 1,
    participant: {
      id: t.id,
      name: t.name,
      short_name: null,
      logo: badge(t.color, t.name.split(' ')[1]![0]!),
    },
    points: 320 - i * 55,
    played: 0,
    won: Math.max(0, 6 - i * 2),
    drawn: 0,
    lost: 0,
    goal_diff: 0,
    form: null,
    description: null,
    podiums: Math.max(0, 12 - i * 3),
    season_team: { id: t.id, name: t.name, livery: { primary: t.color } },
  }));
  return {
    competition: {
      id: RACING_IDS.raceCompetition,
      slug: RACE_SLUG,
      sport: 'formula-1',
      name: 'Campeonato Exemplo de F1',
      logo: null,
      seasons: [{ year, label: String(year), start_date: null, end_date: null, current: true }],
    },
    events: [...weekend, ...others],
    standings: {
      competition_id: RACING_IDS.raceCompetition,
      sport: 'formula-1',
      season: { year, label: String(year) },
      groups: [
        { name: 'drivers', display_name: null, rows: standingRows },
        { name: 'constructors', display_name: null, rows: constructors },
      ],
      updated_at: now.toISOString(),
    },
    driver: {
      id: RACING_IDS.driver,
      sport: 'formula-1',
      kind: 'driver',
      name: 'Lucas Andrade',
      short_name: null,
      logo: badge(RACE_TEAMS[0].color, 'LA'),
      country_ref: { code: 'BR', name: 'Brasil', flag: null },
    },
    career: {
      participant_id: RACING_IDS.driver,
      kind: 'driver',
      profile: {
        first_name: 'Lucas',
        last_name: 'Andrade',
        number: 7,
        birth_date: '2001-04-12',
        birth_country: { code: 'BR', name: 'Brasil', flag: null },
      },
      current_season: year,
      totals: { seasons: 5, races: 104, wins: 12, poles: 15, podiums: 38, fastest_laps: 9, points: 1240 },
      titles: [year - 2],
      best_finish: 1,
      teams: [{ id: RACE_TEAMS[0].id, name: RACE_TEAMS[0].name, logo: null, from: year - 4, to: year }],
      seasons: [{ year, position: 1, final: false, points: 180, races: 18, wins: 4, podiums: 8, poles: 5 }],
      portrait: null,
    },
  };
}

// ─── MMA ─────────────────────────────────────────────────────────────────────────────────────────

const FIGHTERS = [
  ['Caio Ribeiro', 'Diego Navarro', 'Peso-leve'],
  ['Ana Prado', 'Lia Moreno', 'Peso-palha feminino'],
  ['Bruno Teixeira', 'Ivan Petrov', 'Peso-médio'],
  ['Rui Campos', 'Saul Ortega', 'Peso-pena'],
  ['Téo Lima', 'Max Huber', 'Peso-galo'],
] as const;

const fighterId = (bout: number, corner: 0 | 1) =>
  bout === 0 && corner === 0
    ? RACING_IDS.fighter
    : `0199a5c0-0000-7000-8000-0000000005${corner ? 'b' : 'a'}${bout}`;

function fightCompetition(): NonNullable<GsEvent['competition']> {
  return { id: RACING_IDS.fightCompetition, slug: FIGHT_SLUG, name: 'Liga Exemplo de MMA', logo: null };
}

function fighter(bout: number, corner: 0 | 1, winner: boolean | null): GsParticipant {
  const name = FIGHTERS[bout]![corner];
  return {
    side: corner ? 'away' : 'home',
    id: fighterId(bout, corner),
    name,
    short_name: null,
    logo: badge(corner ? '#dc2626' : '#1d4ed8', initialsOf(name)),
    winner,
  };
}

const METHODS = [
  {
    method: 'ko_tko',
    method_name: 'Nocaute técnico',
    detail: 'Socos',
    round: 2,
    time: '3:41',
    scorecards: [],
  },
  {
    method: 'decision_unanimous',
    method_name: 'Decisão unânime',
    detail: null,
    round: 3,
    time: '5:00',
    scorecards: ['29-28', '29-28', '30-27'],
  },
  {
    method: 'submission',
    method_name: 'Finalização',
    detail: 'Mata-leão',
    round: 1,
    time: '4:12',
    scorecards: [],
  },
];

function bout(
  id: string,
  i: number,
  card: { id: string; name: string },
  startsAt: Date,
  finished: boolean,
  segment: 'main_card' | 'prelims',
): GsEvent {
  const homeWins = i % 2 === 0;
  return {
    id,
    sport: 'mma',
    competition: fightCompetition(),
    stage: { name: card.name },
    starts_at: startsAt.toISOString(),
    status: finished ? 'finished' : 'scheduled',
    clock: null,
    participants: [fighter(i, 0, finished ? homeWins : null), fighter(i, 1, finished ? !homeWins : null)],
    score: { home: null, away: null, penalty: null },
    venue: { name: 'Arena Exemplo', city: 'São Paulo', timezone: null },
    fight: {
      card,
      segment,
      main_event: i === 0,
      weight_class: { code: FIGHTERS[i]![2], name: FIGHTERS[i]![2] },
      result: finished ? METHODS[i % METHODS.length]! : null,
    },
  };
}

export interface FightFixtures {
  competition: GsCompetition;
  card: GsFightCard;
  /** Os cards da temporada (o de exemplo e os próximos), uma luta por luta. */
  events: GsEvent[];
  fighter: GsTeam;
  /** As lutas do lutador de exemplo (o cartel). */
  fighterEvents: GsEvent[];
}

export function createFightFixtures(now: Date): FightFixtures {
  const days = (d: number, h = 0) => new Date(now.getTime() + d * 86_400_000 + h * 3_600_000);
  const card = { id: '0199a5c0-0000-7000-8000-0000000005d1', name: 'Liga Exemplo 50: Ribeiro × Navarro' };
  // o card de exemplo foi ontem: as lutas em ordem inversa (preliminares primeiro, a principal por último)
  const fights = FIGHTERS.map((_, i) =>
    bout(
      i === 0 ? RACING_IDS.fightEvent : `0199a5c0-0000-7000-8000-00000000050${i + 1}`,
      i,
      card,
      days(-1, -i),
      true,
      i < 3 ? 'main_card' : 'prelims',
    ),
  );
  const upcoming = [1, 2, 3].map((n) => {
    const next = { id: `0199a5c0-0000-7000-8000-0000000005d${n + 1}`, name: `Liga Exemplo ${50 + n}` };
    return bout(`0199a5c0-0000-7000-8000-00000000052${n}`, n, next, days(n * 21), false, 'main_card');
  });
  upcoming.forEach((e) => (e.fight!.main_event = true));
  // o cartel do lutador de exemplo: lutas encerradas nos últimos anos e a próxima
  const history = [3, 1, 0, 2, 1].map((m, k) => {
    const e = bout(
      `0199a5c0-0000-7000-8000-00000000053${k}`,
      0,
      card,
      days(-120 * (k + 1)),
      true,
      'main_card',
    );
    const won = k !== 2;
    e.participants = [fighter(0, 0, won), fighter(Math.min(m + 1, 4), 1, !won)];
    e.fight = {
      ...e.fight!,
      card: { id: `card-${k}`, name: `Liga Exemplo ${49 - k * 3}` },
      result: METHODS[k % 3]!,
    };
    return e;
  });
  const nextFight = bout(
    '0199a5c0-0000-7000-8000-000000000540',
    0,
    { id: '0199a5c0-0000-7000-8000-0000000005e1', name: 'Liga Exemplo 53' },
    days(63),
    false,
    'main_card',
  );
  nextFight.participants = [fighter(0, 0, null), fighter(2, 1, null)];
  return {
    competition: {
      id: RACING_IDS.fightCompetition,
      slug: FIGHT_SLUG,
      sport: 'mma',
      name: 'Liga Exemplo de MMA',
      logo: null,
      seasons: [],
    },
    card: {
      card: { ...card, starts_at: fights[fights.length - 1]!.starts_at, ends_at: fights[0]!.starts_at },
      fights,
    },
    events: [...fights, ...upcoming],
    fighter: {
      id: RACING_IDS.fighter,
      sport: 'mma',
      kind: 'fighter',
      name: 'Caio Ribeiro',
      short_name: null,
      logo: badge('#1d4ed8', 'CR'),
      country_ref: { code: 'BR', name: 'Brasil', flag: null },
    },
    fighterEvents: [...history, fights[0]!, nextFight],
  };
}
