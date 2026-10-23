/** Formatos da api-sports football v3 consumidos pela normalização (apenas os campos usados). */

export interface ApiTeamRef {
  id: number | null;
  name: string | null;
  logo?: string | null;
  winner?: boolean | null;
}

export interface ApiPersonRef {
  id: number | null;
  name: string | null;
  photo?: string | null;
}

export interface ApiScorePair {
  home: number | null;
  away: number | null;
}

export interface ApiFixtureEvent {
  time: { elapsed: number | null; extra: number | null };
  team: ApiTeamRef;
  player: ApiPersonRef;
  assist: ApiPersonRef;
  type: string;
  detail: string | null;
  comments: string | null;
}

export interface ApiLineupPlayer {
  player: {
    id: number | null;
    name: string | null;
    number: number | null;
    pos: string | null;
    grid: string | null;
  };
}

export interface ApiLineup {
  team: ApiTeamRef & { colors?: unknown };
  coach: ApiPersonRef | null;
  formation: string | null;
  startXI: ApiLineupPlayer[] | null;
  substitutes: ApiLineupPlayer[] | null;
}

export interface ApiFixturePlayers {
  team: ApiTeamRef;
  players: { player: ApiPersonRef; statistics: unknown[] }[];
}

export interface ApiFixture {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    periods?: { first: number | null; second: number | null };
    venue: { id: number | null; name: string | null; city: string | null };
    status: { long: string; short: string; elapsed: number | null; extra?: number | null };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string | null;
    flag: string | null;
    season: number;
    round: string | null;
    standings?: boolean;
  };
  teams: { home: ApiTeamRef; away: ApiTeamRef };
  goals: ApiScorePair;
  score: {
    halftime: ApiScorePair;
    fulltime: ApiScorePair;
    extratime: ApiScorePair;
    penalty: ApiScorePair;
  };
  events?: ApiFixtureEvent[];
  lineups?: ApiLineup[];
  statistics?: unknown[];
  players?: ApiFixturePlayers[];
}

export interface ApiTeamItem {
  team: {
    id: number;
    name: string;
    code: string | null;
    country: string | null;
    founded: number | null;
    national: boolean;
    logo: string | null;
  };
  venue: {
    id: number | null;
    name: string | null;
    address: string | null;
    city: string | null;
    capacity: number | null;
    surface: string | null;
    image: string | null;
  } | null;
}

export interface ApiSquadItem {
  team: ApiTeamRef;
  players: {
    id: number | null;
    name: string | null;
    age: number | null;
    number: number | null;
    position: string | null;
    photo: string | null;
  }[];
}

export interface ApiBirth {
  date: string | null;
  place: string | null;
  country: string | null;
}

export interface ApiCoachItem {
  id: number;
  name: string;
  firstname: string | null;
  lastname: string | null;
  age: number | null;
  birth: ApiBirth | null;
  nationality: string | null;
  height: string | null;
  weight: string | null;
  photo: string | null;
  team: ApiTeamRef | null;
  career: { team: ApiTeamRef; start: string | null; end: string | null }[] | null;
}

export interface ApiPlayerItem {
  player: {
    id: number;
    name: string;
    firstname: string | null;
    lastname: string | null;
    age: number | null;
    birth: ApiBirth | null;
    nationality: string | null;
    height: string | null;
    weight: string | null;
    photo: string | null;
  };
  statistics: {
    team: ApiTeamRef;
    league: {
      id: number | null;
      name?: string | null;
      country?: string | null;
      logo?: string | null;
      season: number | null;
    };
    games: {
      number?: number | null;
      position: string | null;
      appearences?: number | null;
      lineups?: number | null;
      minutes?: number | null;
      rating?: string | null;
      captain?: boolean | null;
    };
    goals?: {
      total?: number | null;
      conceded?: number | null;
      assists?: number | null;
      saves?: number | null;
    };
    cards?: { yellow?: number | null; yellowred?: number | null; red?: number | null };
    [block: string]: unknown;
  }[];
}

/** transfers?team / transfers?player */
export interface ApiTransferItem {
  player: { id: number | null; name: string | null } | null;
  update?: string | null;
  transfers: {
    date: string | null;
    type: string | null;
    teams: { in: ApiTeamRef | null; out: ApiTeamRef | null } | null;
  }[];
}

export interface ApiTrophy {
  league: string | null;
  country: string | null;
  season: string | null;
  place: string | null;
}

/** trophies?players=a-b (com `id` e `trophies`) ou trophies?player=a (a lista direto). */
export type ApiTrophyItem = { id: number; trophies: ApiTrophy[] } | ApiTrophy;

export interface ApiSidelinedEntry {
  type: string | null;
  start: string | null;
  end: string | null;
}

/** sidelined?players=a-b (com `id` e `sidelined`) ou sidelined?player=a (a lista direto). */
export type ApiSidelinedItem = { id: number; sidelined: ApiSidelinedEntry[] } | ApiSidelinedEntry;

export interface ApiStandingRow {
  rank: number;
  team: ApiTeamRef;
  points: number;
  goalsDiff: number;
  group: string | null;
  form: string | null;
  status: string | null;
  description: string | null;
  all: {
    played: number | null;
    win: number | null;
    draw: number | null;
    lose: number | null;
    goals: { for: number | null; against: number | null };
  };
}

export interface ApiStandingsItem {
  league: {
    id: number;
    name: string;
    country: string;
    logo: string | null;
    flag: string | null;
    season: number;
    standings: ApiStandingRow[][];
  };
}
