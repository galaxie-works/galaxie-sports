// Dados de exemplo do hipismo e dos Jogos (Olimpíadas e Pan) para a prévia do Builder e os testes: nomes
// fictícios, sem nenhum atleta, cavalo ou resultado real.
import type {
  GsDelegation,
  GsEqAthlete,
  GsEqCompetition,
  GsEqCompetitionDetail,
  GsEqCountry,
  GsEqHorse,
  GsEqRanking,
  GsEqResult,
  GsGames,
  GsMedalHistory,
  GsMedalTable,
  GsNoc,
  GsNocToday,
  GsScheduleUnit,
} from './core/model.js';

export const OLYMPIC_IDS = {
  eqCompetition: '0199a5c0-0000-7000-8000-00000000e001',
  eqAthlete: '0199a5c0-0000-7000-8000-00000000e101',
  eqHorse: '0199a5c0-0000-7000-8000-00000000e201',
  games: 'jogos-exemplo-2026',
} as const;

const DAY_MS = 86_400_000;
const day = (now: Date, offset: number) =>
  new Date(now.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
const uuid = (prefix: string, n: number) =>
  `0199a5c0-0000-7000-8000-${prefix}${String(n).padStart(12 - prefix.length, '0')}`;

const BRA: GsEqCountry = { code: 'BRA', iso2: 'BR', name: 'Brasil', flag_url: null };
const ARG: GsEqCountry = { code: 'ARG', iso2: 'AR', name: 'Argentina', flag_url: null };
const MEX: GsEqCountry = { code: 'MEX', iso2: 'MX', name: 'México', flag_url: null };
const COL: GsEqCountry = { code: 'COL', iso2: 'CO', name: 'Colômbia', flag_url: null };
const CHI: GsEqCountry = { code: 'CHI', iso2: 'CL', name: 'Chile', flag_url: null };

const RIDERS = [
  { name: 'Rafael Monteiro', country: BRA, horse: 'Vento Sul' },
  { name: 'Lucía Ferreyra', country: ARG, horse: 'Pampa Real' },
  { name: 'Diego Salazar', country: MEX, horse: 'Quetzal' },
  { name: 'Camila Rojas', country: CHI, horse: 'Andino' },
  { name: 'Andrés Cárdenas', country: COL, horse: 'Café Negro' },
  { name: 'Helena Prado', country: BRA, horse: 'Aurora Z' },
  { name: 'Tomás Ibarra', country: ARG, horse: 'Gaucho' },
  { name: 'Marina Duarte', country: BRA, horse: 'Ipê' },
];

export function createEquestrianFixtures(now: Date) {
  const competitions: GsEqCompetition[] = [
    {
      name: 'GP Exemplo CSI5*',
      level: 'CSI5*',
      offset: -3,
      venue: 'São Paulo',
      country: BRA,
      gp: true,
      h: 160,
    },
    {
      name: 'Copa das Nações Exemplo',
      level: 'CSIO4*',
      offset: -10,
      venue: 'Buenos Aires',
      country: ARG,
      gp: false,
      h: 155,
    },
    {
      name: 'GP Exemplo CSI4*',
      level: 'CSI4*',
      offset: 6,
      venue: 'Cidade do México',
      country: MEX,
      gp: true,
      h: 155,
    },
    {
      name: 'Copa Exemplo CSI3*',
      level: 'CSI3*',
      offset: 13,
      venue: 'Bogotá',
      country: COL,
      gp: false,
      h: 145,
    },
    {
      name: 'GP Exemplo CSI5*-W',
      level: 'CSI5*-W',
      offset: 20,
      venue: 'Santiago',
      country: CHI,
      gp: true,
      h: 160,
    },
  ].map((c, i) => ({
    id: i === 0 ? OLYMPIC_IDS.eqCompetition : uuid('e0', i + 1),
    name: c.name,
    level: c.level,
    date: day(now, c.offset),
    venue: c.venue,
    country: c.country,
    height_cm: c.h,
    is_grand_prix: c.gp,
  }));
  const horseRef = (i: number) => ({
    id: i === 0 ? OLYMPIC_IDS.eqHorse : uuid('e2', i + 1),
    name: RIDERS[i]!.horse,
    breed: ['BH', 'KWPN', 'SF', 'Holst', 'Oldbg'][i % 5]!,
    born_year: now.getUTCFullYear() - 10 - (i % 4),
    age: 10 + (i % 4),
  });
  const athleteRef = (i: number) => ({
    id: i === 0 ? OLYMPIC_IDS.eqAthlete : uuid('e1', i + 1),
    name: RIDERS[i]!.name,
    country: RIDERS[i]!.country,
  });
  const scores = [
    [0, 38.41],
    [0, 39.02],
    [0, 40.15],
    [4, 37.9],
    [4, 41.3],
    [8, 42.77],
    [9, 44.01],
  ];
  const result = (
    i: number,
    c: GsEqCompetition,
    position: number | null,
    status = 'classified',
  ): GsEqResult => ({
    id: uuid('e3', Number(`${competitions.indexOf(c) + 1}${i}`)),
    date: c.date,
    competition: c,
    athlete: athleteRef(i),
    athlete_name_as_published: RIDERS[i]!.name,
    horse: horseRef(i),
    horse_name_as_published: RIDERS[i]!.horse,
    country: RIDERS[i]!.country,
    position,
    position_raw: position ? String(position) : status,
    status,
    score: {
      raw: null,
      penalties: status === 'classified' ? scores[i]![0]! : null,
      time_seconds: status === 'classified' ? scores[i]![1]! : null,
    },
    prize: position
      ? { amount: 20000 / position, currency: 'USD', raw: `${Math.round(20000 / position)} USD` }
      : null,
  });
  const latest = competitions[0]!;
  const detail: GsEqCompetitionDetail = {
    ...latest,
    standings: [...RIDERS.slice(0, 7).map((_, i) => result(i, latest, i + 1)), result(7, latest, null, 'EL')],
  };
  const resultsOf = (filter: (r: GsEqResult) => boolean) =>
    competitions
      .filter((c) => (c.date ?? '') <= day(now, 0))
      .flatMap((c) => RIDERS.slice(0, 7).map((_, i) => result(i, c, i + 1)))
      .filter(filter);
  const rankings: GsEqRanking[] = RIDERS.map((_, i) => ({
    id: uuid('e4', i + 1),
    ranking: 'Ranking Mundial de Salto',
    athlete: athleteRef(i),
    horse: null,
    horse_name_as_published: null,
    rank: 12 + i * 7,
    points: 2450 - i * 160,
    edition: null,
  }));
  const athlete: GsEqAthlete = {
    ...athleteRef(0),
    stats: { results: 142, classified: 131, wins: 18, podiums: 47, last_result: latest.date },
    horses: [0, 5, 7].map((i, k) => ({ ...horseRef(i), results: 60 - k * 18, best_position: k + 1 })),
    rankings: [rankings[0]!],
  };
  const horse: GsEqHorse = {
    ...horseRef(0),
    gender: 'gelding',
    color: 'Castanho',
    studbook: 'BH',
    sire: 'Vento Norte',
    dam: 'Brisa Clara',
    dam_sire: 'Trovão',
    riders: [
      { ...athleteRef(0), results: 54 },
      { ...athleteRef(5), results: 9 },
    ],
    stats: { results: 63, wins: 9, podiums: 22 },
  };
  return { competitions, detail, rankings, athlete, horse, resultsOf };
}

const NOCS: GsNoc[] = [
  { code: 'USA', name: 'Estados Unidos', iso2: 'US' },
  { code: 'CHN', name: 'China', iso2: 'CN' },
  { code: 'JPN', name: 'Japão', iso2: 'JP' },
  { code: 'FRA', name: 'França', iso2: 'FR' },
  { code: 'GBR', name: 'Grã-Bretanha', iso2: 'GB' },
  { code: 'AUS', name: 'Austrália', iso2: 'AU' },
  { code: 'ITA', name: 'Itália', iso2: 'IT' },
  { code: 'GER', name: 'Alemanha', iso2: 'DE' },
  { code: 'NED', name: 'Países Baixos', iso2: 'NL' },
  { code: 'KOR', name: 'Coreia do Sul', iso2: 'KR' },
  { code: 'CAN', name: 'Canadá', iso2: 'CA' },
  { code: 'ESP', name: 'Espanha', iso2: 'ES' },
  { code: 'BRA', name: 'Brasil', iso2: 'BR' },
  { code: 'ARG', name: 'Argentina', iso2: 'AR' },
  { code: 'MEX', name: 'México', iso2: 'MX' },
];

export function createGamesFixtures(now: Date) {
  const games: GsGames = {
    slug: OLYMPIC_IDS.games,
    type: 'OG',
    season: 'summer',
    year: now.getUTCFullYear(),
    name: `Jogos de Exemplo ${now.getUTCFullYear()}`,
    host_city: 'Cidade Exemplo',
    start_date: day(now, -5),
    end_date: day(now, 9),
    tz: 'America/Sao_Paulo',
    status: 'in_progress',
  };
  const medals: GsMedalTable = {
    games,
    data_quality: { level: 'complete', publishable: true },
    data: NOCS.map((noc, i) => {
      const gold = Math.max(0, 22 - i * 2);
      const silver = Math.max(1, 18 - i);
      const bronze = Math.max(2, 16 - i);
      return { rank: i + 1, noc, gold, silver, bronze, total: gold + silver + bronze };
    }),
  };
  const at = (h: number, m = 0) => {
    const d = new Date(now);
    d.setUTCHours(h, m, 0, 0);
    return d.toISOString();
  };
  const unit = (
    n: number,
    sport: [string, string],
    event: string,
    phase: string,
    starts: string,
    status: GsScheduleUnit['status'],
    medal = false,
  ): GsScheduleUnit => ({
    id: uuid('f0', n),
    name: null,
    starts_at: starts,
    status,
    venue: ['Arena Central', 'Estádio Aquático', 'Parque Olímpico'][n % 3]!,
    is_medal_unit: medal,
    phase: { code: phase.toUpperCase(), name: phase },
    event: {
      id: uuid('f1', n),
      name: event,
      discipline: { code: sport[0], name: sport[1], sport: { code: sport[0], name: sport[1] } },
    },
  });
  const units: GsScheduleUnit[] = [
    unit(1, ['SWM', 'Natação'], '100 m livre feminino', 'Eliminatórias', at(12), 'finished'),
    unit(2, ['JUD', 'Judô'], 'Até 57 kg feminino', 'Oitavas de final', at(14), 'finished'),
    unit(3, ['VBV', 'Vôlei de praia'], 'Masculino', 'Quartas de final', at(16), 'live'),
    unit(4, ['ATH', 'Atletismo'], 'Salto com vara masculino', 'Final', at(19), 'scheduled', true),
    unit(5, ['GAR', 'Ginástica artística'], 'Solo feminino', 'Final', at(20, 30), 'scheduled', true),
    unit(6, ['SKB', 'Skate'], 'Street feminino', 'Final', at(22), 'scheduled', true),
  ];
  const bra = NOCS.find((n) => n.code === 'BRA')!;
  const today: GsNocToday = {
    games,
    noc: bra,
    date: day(now, 0),
    units: units.filter((u) => u.id !== uuid('f0', 6)),
    medals: [
      {
        medal: 'S',
        participant: { id: uuid('f2', 1), name: 'Bianca Moreira' },
        event: { id: uuid('f1', 2), name: 'Até 57 kg feminino' },
        revoked: false,
      },
    ],
  };
  const delegation: GsDelegation = {
    games,
    noc: bra,
    data: [
      { name: 'Bianca Moreira', medal: 'S' as const, event: 'Judô · Até 57 kg feminino' },
      { name: 'Caio Ventura', medal: 'G' as const, event: 'Surfe · Masculino' },
      { name: 'Larissa Pontes', medal: null, event: 'Natação · 100 m livre feminino' },
      { name: 'Pedro Alencar', medal: 'B' as const, event: 'Boxe · Até 63 kg' },
      { name: 'Júlia Tavares', medal: null, event: 'Ginástica artística · Solo feminino' },
    ].map((a, i) => ({
      person_id: uuid('f3', i + 1),
      name: a.name,
      medals: {
        gold: a.medal === 'G' ? 1 : 0,
        silver: a.medal === 'S' ? 1 : 0,
        bronze: a.medal === 'B' ? 1 : 0,
        total: a.medal ? 1 : 0,
      },
      events: [{ id: uuid('f4', i + 1), name: a.event, medal: a.medal }],
    })),
  };
  const editions = [
    { type: 'OG', year: 2024, name: 'Jogos Olímpicos Paris 2024', g: 3, s: 7, b: 10 },
    { type: 'PAN', year: 2023, name: 'Pan Santiago 2023', g: 66, s: 73, b: 66 },
    { type: 'OG', year: 2021, name: 'Jogos Olímpicos Tóquio 2020', g: 7, s: 6, b: 8 },
    { type: 'PAN', year: 2019, name: 'Pan Lima 2019', g: 55, s: 45, b: 71 },
    { type: 'OG', year: 2016, name: 'Jogos Olímpicos Rio 2016', g: 7, s: 6, b: 6 },
  ];
  const history: GsMedalHistory = {
    nocs: [bra],
    data: editions.map((e, i) => ({
      games: {
        slug: `${e.type.toLowerCase()}-${e.year}`,
        type: e.type,
        season: 'summer',
        year: e.year,
        name: e.name,
      },
      noc: 'BRA',
      gold: e.g,
      silver: e.s,
      bronze: e.b,
      total: e.g + e.s + e.b,
      rank_by_gold: 10 + i,
    })),
    totals: [
      {
        noc: 'BRA',
        gold: editions.reduce((n, e) => n + e.g, 0),
        silver: editions.reduce((n, e) => n + e.s, 0),
        bronze: editions.reduce((n, e) => n + e.b, 0),
        total: editions.reduce((n, e) => n + e.g + e.s + e.b, 0),
      },
    ],
    withheld: [],
  };
  return { games, medals, units, today, delegation, history };
}

/** Resposta da prévia para as rotas do hipismo e dos Jogos (null = não é rota daqui). */
export function olympicPreviewBody(url: URL, now: Date): unknown | null {
  const path = url.pathname.replace(/\/+$/, '');
  if (path.includes('/v1/equestrian/')) {
    const eq = createEquestrianFixtures(now);
    const q = url.searchParams;
    if (path.endsWith('/v1/equestrian/overview'))
      return { highlights: [eq.athlete], recent_competitions: eq.competitions.slice(0, 2) };
    if (path.endsWith('/v1/equestrian/competitions')) {
      const from = q.get('from');
      const to = q.get('to');
      const list = eq.competitions
        .filter((c) => (!from || (c.date ?? '') >= from) && (!to || (c.date ?? '') <= to))
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
      return { data: list.slice(0, Number(q.get('limit')) || 50), next_cursor: null };
    }
    if (/\/v1\/equestrian\/competitions\/[^/]+$/.test(path)) return eq.detail;
    if (path.endsWith('/v1/equestrian/rankings')) return { data: eq.rankings };
    if (path.endsWith('/v1/equestrian/results')) {
      const athlete = q.get('athlete');
      const horse = q.get('horse');
      const rows = eq
        .resultsOf((r) => (!athlete || r.athlete?.id === athlete) && (!horse || r.horse?.id === horse))
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
      return { data: rows.slice(0, Number(q.get('limit')) || 20), next_cursor: null };
    }
    if (/\/v1\/equestrian\/athletes\/[^/]+$/.test(path)) return eq.athlete;
    if (path.endsWith('/v1/equestrian/horses')) return { data: [eq.horse], next_cursor: null };
    if (/\/v1\/equestrian\/horses\/[^/]+$/.test(path)) return eq.horse;
    return null;
  }
  if (path.includes('/v1/multisport/')) {
    const g = createGamesFixtures(now);
    const q = url.searchParams;
    if (path.endsWith('/v1/multisport/games')) return { data: [g.games] };
    if (path.endsWith('/v1/multisport/history/medals')) return g.history;
    if (/\/games\/[^/]+$/.test(path)) return { ...g.games, competitions: [] };
    if (path.endsWith('/medals')) {
      const latam = q.get('region') === 'latam' ? new Set(['BRA', 'ARG', 'MEX']) : null;
      const rows = latam ? g.medals.data.filter((r) => latam.has(r.noc.code)) : g.medals.data;
      const sorted = q.get('sort') === 'total' ? [...rows].sort((a, b) => b.total - a.total) : rows;
      return { ...g.medals, data: sorted };
    }
    if (path.endsWith('/schedule')) {
      const medalOnly = q.get('medal_only') === 'true';
      return { data: g.units.filter((u) => !medalOnly || u.is_medal_unit), next_cursor: null };
    }
    if (/\/today\/[^/]+$/.test(path)) return g.today;
    if (/\/athletes$/.test(path)) return g.delegation;
    return null;
  }
  return null;
}
