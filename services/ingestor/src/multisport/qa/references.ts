/**
 * Totais conferidos manualmente na Wikipedia (quadros finais, consultados em 21/10/2026) — usados SÓ no
 * controle de qualidade da carga; o quadro do produto é sempre derivado das linhas de medalha.
 * Números isolados (fatos), sem reprodução de texto: compatível com CC BY-SA.
 */

export interface MedalReference {
  games: string;
  noc: string;
  gold: number;
  silver: number;
  bronze: number;
  url: string;
}

const W = {
  og2016: 'https://en.wikipedia.org/wiki/2016_Summer_Olympics_medal_table',
  og2020: 'https://en.wikipedia.org/wiki/2020_Summer_Olympics_medal_table',
  og2024: 'https://en.wikipedia.org/wiki/2024_Summer_Olympics_medal_table',
  ow2026: 'https://en.wikipedia.org/wiki/2026_Winter_Olympics_medal_table',
  pan2019: 'https://en.wikipedia.org/wiki/2019_Pan_American_Games_medal_table',
  pan2023: 'https://en.wikipedia.org/wiki/2023_Pan_American_Games_medal_table',
};

const r = (games: string, url: string, rows: [string, number, number, number][]): MedalReference[] =>
  rows.map(([noc, gold, silver, bronze]) => ({ games, noc, gold, silver, bronze, url }));

export const WIKIPEDIA_REFERENCES: MedalReference[] = [
  ...r('og-summer-2016', W.og2016, [
    ['USA', 46, 37, 38],
    ['BRA', 7, 6, 6],
    ['ARG', 3, 1, 0],
    ['COL', 3, 2, 3],
    ['CUB', 5, 2, 4],
    ['MEX', 0, 3, 2],
    ['VEN', 0, 2, 1],
    ['PUR', 1, 0, 0],
    ['DOM', 0, 0, 1],
  ]),
  ...r('og-summer-2020', W.og2020, [
    ['USA', 39, 41, 33],
    ['BRA', 7, 6, 8],
    ['ARG', 0, 1, 2],
    ['COL', 0, 4, 1],
    ['CUB', 7, 3, 5],
    ['MEX', 0, 0, 4],
    ['ECU', 2, 1, 0],
    ['VEN', 1, 3, 0],
    ['DOM', 0, 3, 2],
  ]),
  ...r('og-summer-2024', W.og2024, [
    ['USA', 40, 44, 42],
    ['CHN', 40, 27, 24],
    ['BRA', 3, 7, 10],
    ['ARG', 1, 1, 1],
    ['COL', 0, 3, 1],
    ['CUB', 2, 1, 6],
    ['MEX', 0, 3, 2],
    ['CHI', 1, 1, 0],
    ['ECU', 1, 2, 2],
    ['DOM', 1, 0, 2],
    ['PER', 0, 0, 1],
    ['GUA', 1, 0, 1],
  ]),
  ...r('og-winter-2026', W.ow2026, [['BRA', 1, 0, 0]]),
  ...r('pan-2019', W.pan2019, [
    ['USA', 122, 87, 84],
    ['BRA', 54, 45, 70],
    ['MEX', 37, 39, 62],
    ['CAN', 35, 65, 52],
    ['CUB', 33, 28, 39],
    ['ARG', 33, 33, 34],
    ['COL', 27, 24, 31],
    ['CHI', 13, 19, 18],
    ['PER', 11, 7, 23],
  ]),
  ...r('pan-2023', W.pan2023, [
    ['USA', 124, 75, 87],
    ['BRA', 66, 73, 66],
    ['MEX', 52, 38, 52],
    ['COL', 29, 38, 34],
    ['ARG', 17, 25, 33],
    ['CHI', 12, 31, 36],
    ['PER', 10, 6, 16],
    ['ECU', 7, 12, 17],
    ['URU', 2, 5, 3],
  ]),
];

/** Total de medalhas distribuídas na edição (todas as delegações), para medir a cobertura da carga. */
export const EDITION_TOTALS: Record<string, { gold: number; silver: number; bronze: number; url: string }> = {
  'og-summer-2016': { gold: 306, silver: 307, bronze: 359, url: W.og2016 },
  'og-summer-2020': { gold: 340, silver: 338, bronze: 402, url: W.og2020 },
  'og-summer-2024': { gold: 329, silver: 330, bronze: 385, url: W.og2024 },
  'pan-2019': { gold: 419, silver: 419, bronze: 522, url: W.pan2019 },
};
