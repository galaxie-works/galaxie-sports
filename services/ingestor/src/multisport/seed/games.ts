/**
 * Edições dos Jogos Olímpicos (Verão 1896–2032, Inverno 1924–2030) e Pan-Americanos (1951–2027).
 * Datas = cerimônia de abertura → encerramento (ou primeiro/último dia de competição nas edições antigas).
 * Fontes: Wikidata (P580/P582, CC0) conferido com as páginas de cada edição; Lima 2027 com as datas
 * remarcadas em jan/2026 (23/07–08/08). Edições canceladas (1916, 1940, 1944) não entram.
 */

export type GamesType = 'OG' | 'PAN';
export type GamesSeason = 'summer' | 'winter';

export interface GamesSeed {
  slug: string;
  type: GamesType;
  season: GamesSeason;
  year: number;
  edition: number;
  hostCity: string;
  hostNoc: string;
  startDate: string;
  endDate: string;
  tz: string;
  wikidataQid: string | null;
  notes?: string;
}

// [ano, edição, cidade, CON sede, início, fim, fuso, QID]
type Row = [number, number, string, string, string, string, string, string | null, string?];

const SUMMER: Row[] = [
  [1896, 1, 'Athens', 'GRE', '1896-04-06', '1896-04-15', 'Europe/Athens', 'Q8080'],
  [1900, 2, 'Paris', 'FRA', '1900-05-14', '1900-10-28', 'Europe/Paris', 'Q8088'],
  [1904, 3, 'St. Louis', 'USA', '1904-07-01', '1904-11-23', 'America/Chicago', 'Q8098'],
  [1908, 4, 'London', 'GBR', '1908-04-27', '1908-10-31', 'Europe/London', 'Q8111'],
  [1912, 5, 'Stockholm', 'SWE', '1912-05-05', '1912-07-27', 'Europe/Stockholm', 'Q8118'],
  [1920, 7, 'Antwerp', 'BEL', '1920-04-20', '1920-09-12', 'Europe/Brussels', 'Q8128'],
  [1924, 8, 'Paris', 'FRA', '1924-05-04', '1924-07-27', 'Europe/Paris', 'Q8132'],
  [1928, 9, 'Amsterdam', 'NED', '1928-07-28', '1928-08-12', 'Europe/Amsterdam', 'Q8138'],
  [1932, 10, 'Los Angeles', 'USA', '1932-07-30', '1932-08-14', 'America/Los_Angeles', 'Q8143'],
  [1936, 11, 'Berlin', 'GER', '1936-08-01', '1936-08-16', 'Europe/Berlin', 'Q8150'],
  [1948, 14, 'London', 'GBR', '1948-07-29', '1948-08-14', 'Europe/London', 'Q8403'],
  [1952, 15, 'Helsinki', 'FIN', '1952-07-19', '1952-08-03', 'Europe/Helsinki', 'Q8407'],
  [
    1956,
    16,
    'Melbourne',
    'AUS',
    '1956-11-22',
    '1956-12-08',
    'Australia/Melbourne',
    'Q8411',
    'Hipismo disputado em Estocolmo (SWE), 10–17 jun 1956.',
  ],
  [1960, 17, 'Rome', 'ITA', '1960-08-25', '1960-09-11', 'Europe/Rome', 'Q8415'],
  [1964, 18, 'Tokyo', 'JPN', '1964-10-10', '1964-10-24', 'Asia/Tokyo', 'Q8420'],
  [1968, 19, 'Mexico City', 'MEX', '1968-10-12', '1968-10-27', 'America/Mexico_City', 'Q8429'],
  [1972, 20, 'Munich', 'FRG', '1972-08-26', '1972-09-11', 'Europe/Berlin', 'Q8438'],
  [1976, 21, 'Montreal', 'CAN', '1976-07-17', '1976-08-01', 'America/Toronto', 'Q8444'],
  [1980, 22, 'Moscow', 'URS', '1980-07-19', '1980-08-03', 'Europe/Moscow', 'Q8450'],
  [1984, 23, 'Los Angeles', 'USA', '1984-07-28', '1984-08-12', 'America/Los_Angeles', 'Q8456'],
  [1988, 24, 'Seoul', 'KOR', '1988-09-17', '1988-10-02', 'Asia/Seoul', 'Q8470'],
  [1992, 25, 'Barcelona', 'ESP', '1992-07-25', '1992-08-09', 'Europe/Madrid', 'Q8488'],
  [1996, 26, 'Atlanta', 'USA', '1996-07-19', '1996-08-04', 'America/New_York', 'Q8531'],
  [2000, 27, 'Sydney', 'AUS', '2000-09-15', '2000-10-01', 'Australia/Sydney', 'Q8544'],
  [2004, 28, 'Athens', 'GRE', '2004-08-13', '2004-08-29', 'Europe/Athens', 'Q8558'],
  [2008, 29, 'Beijing', 'CHN', '2008-08-08', '2008-08-24', 'Asia/Shanghai', 'Q8567'],
  [2012, 30, 'London', 'GBR', '2012-07-27', '2012-08-12', 'Europe/London', 'Q8577'],
  [2016, 31, 'Rio de Janeiro', 'BRA', '2016-08-05', '2016-08-21', 'America/Sao_Paulo', 'Q8613'],
  [
    2020,
    32,
    'Tokyo',
    'JPN',
    '2021-07-23',
    '2021-08-08',
    'Asia/Tokyo',
    'Q181278',
    'Adiado para 2021 pela pandemia; mantém o nome "Tóquio 2020".',
  ],
  [2024, 33, 'Paris', 'FRA', '2024-07-26', '2024-08-11', 'Europe/Paris', 'Q995653'],
  [2028, 34, 'Los Angeles', 'USA', '2028-07-14', '2028-07-30', 'America/Los_Angeles', 'Q1451505'],
  [2032, 35, 'Brisbane', 'AUS', '2032-07-23', '2032-08-08', 'Australia/Brisbane', 'Q31039462'],
];

const WINTER: Row[] = [
  [1924, 1, 'Chamonix', 'FRA', '1924-01-25', '1924-02-05', 'Europe/Paris', 'Q9583'],
  [1928, 2, 'St. Moritz', 'SUI', '1928-02-11', '1928-02-19', 'Europe/Zurich', 'Q9591'],
  [1932, 3, 'Lake Placid', 'USA', '1932-02-04', '1932-02-15', 'America/New_York', 'Q9596'],
  [1936, 4, 'Garmisch-Partenkirchen', 'GER', '1936-02-06', '1936-02-16', 'Europe/Berlin', 'Q9600'],
  [1948, 5, 'St. Moritz', 'SUI', '1948-01-30', '1948-02-08', 'Europe/Zurich', 'Q9615'],
  [1952, 6, 'Oslo', 'NOR', '1952-02-14', '1952-02-25', 'Europe/Oslo', 'Q9623'],
  [1956, 7, "Cortina d'Ampezzo", 'ITA', '1956-01-26', '1956-02-05', 'Europe/Rome', 'Q9632'],
  [1960, 8, 'Squaw Valley', 'USA', '1960-02-18', '1960-02-28', 'America/Los_Angeles', 'Q9634'],
  [1964, 9, 'Innsbruck', 'AUT', '1964-01-29', '1964-02-09', 'Europe/Vienna', 'Q9636'],
  [1968, 10, 'Grenoble', 'FRA', '1968-02-06', '1968-02-18', 'Europe/Paris', 'Q9642'],
  [1972, 11, 'Sapporo', 'JPN', '1972-02-03', '1972-02-13', 'Asia/Tokyo', 'Q9646'],
  [1976, 12, 'Innsbruck', 'AUT', '1976-02-04', '1976-02-15', 'Europe/Vienna', 'Q9651'],
  [1980, 13, 'Lake Placid', 'USA', '1980-02-13', '1980-02-24', 'America/New_York', 'Q9652'],
  [1984, 14, 'Sarajevo', 'YUG', '1984-02-08', '1984-02-19', 'Europe/Sarajevo', 'Q9657'],
  [1988, 15, 'Calgary', 'CAN', '1988-02-13', '1988-02-28', 'America/Edmonton', 'Q9658'],
  [1992, 16, 'Albertville', 'FRA', '1992-02-08', '1992-02-23', 'Europe/Paris', 'Q9660'],
  [1994, 17, 'Lillehammer', 'NOR', '1994-02-12', '1994-02-27', 'Europe/Oslo', 'Q9663'],
  [1998, 18, 'Nagano', 'JPN', '1998-02-07', '1998-02-22', 'Asia/Tokyo', 'Q9664'],
  [2002, 19, 'Salt Lake City', 'USA', '2002-02-08', '2002-02-24', 'America/Denver', 'Q9668'],
  [2006, 20, 'Turin', 'ITA', '2006-02-10', '2006-02-26', 'Europe/Rome', 'Q9672'],
  [2010, 21, 'Vancouver', 'CAN', '2010-02-12', '2010-02-28', 'America/Vancouver', 'Q9674'],
  [2014, 22, 'Sochi', 'RUS', '2014-02-07', '2014-02-23', 'Europe/Moscow', 'Q9678'],
  [2018, 23, 'PyeongChang', 'KOR', '2018-02-09', '2018-02-25', 'Asia/Seoul', 'Q9680'],
  [2022, 24, 'Beijing', 'CHN', '2022-02-04', '2022-02-20', 'Asia/Shanghai', 'Q193074'],
  [
    2026,
    25,
    'Milano Cortina',
    'ITA',
    '2026-02-06',
    '2026-02-22',
    'Europe/Rome',
    'Q4630399',
    'Primeira medalha (ouro) do Brasil em Jogos de Inverno: Lucas Pinheiro Braathen, slalom gigante.',
  ],
  [2030, 26, 'French Alps', 'FRA', '2030-02-01', '2030-02-17', 'Europe/Paris', 'Q29389034'],
];

const PAN: Row[] = [
  [1951, 1, 'Buenos Aires', 'ARG', '1951-02-25', '1951-03-09', 'America/Argentina/Buenos_Aires', 'Q1203233'],
  [1955, 2, 'Mexico City', 'MEX', '1955-03-12', '1955-03-26', 'America/Mexico_City', 'Q1203213'],
  [1959, 3, 'Chicago', 'USA', '1959-08-27', '1959-09-07', 'America/Chicago', 'Q1202025'],
  [1963, 4, 'São Paulo', 'BRA', '1963-04-20', '1963-05-05', 'America/Sao_Paulo', 'Q1192716'],
  [1967, 5, 'Winnipeg', 'CAN', '1967-07-23', '1967-08-06', 'America/Winnipeg', 'Q1348494'],
  [1971, 6, 'Cali', 'COL', '1971-07-30', '1971-08-13', 'America/Bogota', 'Q1348545'],
  [1975, 7, 'Mexico City', 'MEX', '1975-10-12', '1975-10-26', 'America/Mexico_City', 'Q1347052'],
  [1979, 8, 'San Juan', 'PUR', '1979-07-01', '1979-07-15', 'America/Puerto_Rico', 'Q1348525'],
  [1983, 9, 'Caracas', 'VEN', '1983-08-14', '1983-08-29', 'America/Caracas', 'Q994966'],
  [1987, 10, 'Indianapolis', 'USA', '1987-08-07', '1987-08-23', 'America/Indiana/Indianapolis', 'Q1192877'],
  [1991, 11, 'Havana', 'CUB', '1991-08-02', '1991-08-18', 'America/Havana', 'Q571772'],
  [1995, 12, 'Mar del Plata', 'ARG', '1995-03-11', '1995-03-26', 'America/Argentina/Buenos_Aires', 'Q615281'],
  [1999, 13, 'Winnipeg', 'CAN', '1999-07-23', '1999-08-08', 'America/Winnipeg', 'Q1350229'],
  [2003, 14, 'Santo Domingo', 'DOM', '2003-08-01', '2003-08-17', 'America/Santo_Domingo', 'Q589100'],
  [2007, 15, 'Rio de Janeiro', 'BRA', '2007-07-13', '2007-07-29', 'America/Sao_Paulo', 'Q1059469'],
  [2011, 16, 'Guadalajara', 'MEX', '2011-10-14', '2011-10-30', 'America/Mexico_City', 'Q2049076'],
  [2015, 17, 'Toronto', 'CAN', '2015-07-10', '2015-07-26', 'America/Toronto', 'Q1185431'],
  [2019, 18, 'Lima', 'PER', '2019-07-26', '2019-08-11', 'America/Lima', 'Q4630365'],
  [2023, 19, 'Santiago', 'CHI', '2023-10-20', '2023-11-05', 'America/Santiago', 'Q16585569'],
  [
    2027,
    20,
    'Lima',
    'PER',
    '2027-07-23',
    '2027-08-08',
    'America/Lima',
    'Q29545388',
    'Datas remarcadas em jan/2026 (antes 16/07–01/08); conferir periodicamente no site oficial.',
  ],
];

function toSeed(type: GamesType, season: GamesSeason, prefix: string, rows: Row[]): GamesSeed[] {
  return rows.map(([year, edition, hostCity, hostNoc, startDate, endDate, tz, wikidataQid, notes]) => ({
    slug: `${prefix}-${year}`,
    type,
    season,
    year,
    edition,
    hostCity,
    hostNoc,
    startDate,
    endDate,
    tz,
    wikidataQid,
    ...(notes ? { notes } : {}),
  }));
}

export const GAMES_SEED: GamesSeed[] = [
  ...toSeed('OG', 'summer', 'og-summer', SUMMER),
  ...toSeed('OG', 'winter', 'og-winter', WINTER),
  ...toSeed('PAN', 'summer', 'pan', PAN),
];

const SEASON_LABEL = {
  summer: { 'pt-BR': 'Jogos Olímpicos', es: 'Juegos Olímpicos', en: 'Summer Olympics' },
  winter: {
    'pt-BR': 'Jogos Olímpicos de Inverno',
    es: 'Juegos Olímpicos de Invierno',
    en: 'Winter Olympics',
  },
} as const;

/** Nome exibível: "Jogos Olímpicos Rio de Janeiro 2016", "Juegos Panamericanos Lima 2027"... */
export function gamesName(g: Pick<GamesSeed, 'type' | 'season' | 'year' | 'hostCity'>): {
  'pt-BR': string;
  es: string;
  en: string;
} {
  if (g.type === 'PAN')
    return {
      'pt-BR': `Jogos Pan-Americanos ${g.hostCity} ${g.year}`,
      es: `Juegos Panamericanos ${g.hostCity} ${g.year}`,
      en: `${g.year} Pan American Games`,
    };
  const l = SEASON_LABEL[g.season];
  return {
    'pt-BR': `${l['pt-BR']} ${g.hostCity} ${g.year}`,
    es: `${l.es} ${g.hostCity} ${g.year}`,
    en: `${g.year} ${l.en}`,
  };
}

/** completed | in_progress | upcoming, conforme a data de referência (YYYY-MM-DD). */
export function gamesStatus(
  g: Pick<GamesSeed, 'startDate' | 'endDate'>,
  today: string,
): 'completed' | 'in_progress' | 'upcoming' {
  if (today > g.endDate) return 'completed';
  if (today >= g.startDate) return 'in_progress';
  return 'upcoming';
}
