/**
 * Amostra de dados reais para os exemplos da apresentação pública, copiada da API em 23/10/2026. Duas
 * versões, pelo idioma da página:
 *
 * - Brasil (pt-BR e inglês): a semifinal Palmeiras x Fluminense da Libertadores (lances, pênaltis,
 *   estatísticas, relevância por país e confronto direto) e Palmeiras x RB Bragantino no Brasileirão
 *   (tags do torcedor, o que está em jogo e onde assistir no Brasil).
 * - Argentina (espanhol): a semifinal Flamengo x Estudiantes e a final Palmeiras x Estudiantes (onde
 *   assistir na Argentina). Sem resumo pós-jogo gerado ainda, entra o cenário pré-jogo.
 *
 * Estática de propósito: a página pública não chama a API. Escudos copiados para `/public/crests` (as
 * iniciais na cor do clube ficam de reserva). Sem nomes de canais: o "onde assistir" aparece só pelo
 * tipo de mídia.
 */
import type { Locale } from './i18n/config';
import { PROPER_NAMES as N } from './i18n/messages/proper-names';

export interface ShowcaseTeam {
  name: string;
  nickname: string;
  color: string;
  /** Escudo em /public/crests. */
  crest?: string;
}

type Side = 'home' | 'away';

export type TimelineEntry =
  | { minute: number; kind: 'yellow' | 'red'; side: Side; player: string }
  | { minute: number; kind: 'sub'; side: Side; in: string; out: string }
  | { minute: number; kind: 'goal'; side: Side; player: string; assist: string }
  | { minute: null; kind: 'decisive' | 'decisiveMiss'; side: Side; player: string };

type StatKey = 'possession' | 'xg' | 'shots' | 'passes' | 'corners';
type Medium = 'free_tv' | 'pay_tv' | 'streaming' | 'youtube';
/** Textos do que está em jogo ficam no dicionário (`stakes.list.s1…s5`), na voz de cada mercado. */
type StakeKey = 's1' | 's2' | 's3' | 's4' | 's5';
type MeetingStage = 'semiFirstLeg' | 'semiSecondLeg' | 'round' | 'groupRound';

export interface Showcase {
  /** Mercado da versão: fuso do horário do próximo jogo e país do "onde assistir". */
  market: 'BR' | 'AR';
  timeZone: string;
  semi: {
    competition: string;
    home: ShowcaseTeam;
    away: ShowcaseTeam;
    score: { home: number; away: number };
    shootout: { home: number; away: number };
    timeline: TimelineEntry[];
    stats: { key: StatKey; home: number; away: number; unit: string }[];
    /** Nota 0–100 por mercado (os primeiros da lista da API), com o motivo nos dois primeiros. */
    relevance: { market: string; score: number; reason?: 'reasonBR' | 'reasonAR' }[];
  };
  round: {
    competition: string;
    startsAt: string;
    home: ShowcaseTeam;
    away: ShowcaseTeam;
    watch: { medium: Medium; count: number }[];
    stakes: { team: Side | 'both'; key: StakeKey; warn?: boolean }[];
  };
  h2h: {
    played: number;
    draws: number;
    home: ShowcaseTeam & { wins: number; goals: number };
    away: ShowcaseTeam & { wins: number; goals: number };
    /** Mais recentes primeiro; `home` diz qual dos dois times jogou em casa. */
    meetings: {
      date: string;
      competition: string;
      stage: MeetingStage;
      round?: number;
      home: Side;
      score: [number, number];
      penalties?: [number, number];
    }[];
  };
  /** Time do selo "na final" do herói. */
  finalist: ShowcaseTeam;
}

const TEAMS = {
  palmeiras: { name: N.palmeiras, nickname: N.verdao, color: '#01713d', crest: '/crests/palmeiras.png' },
  fluminense: { name: N.fluminense, nickname: N.flu, color: '#900028', crest: '/crests/fluminense.png' },
  bragantino: {
    name: N.bragantino,
    nickname: N.massaBruta,
    color: '#bd2b38',
    crest: '/crests/bragantino.png',
  },
  flamengo: { name: N.flamengo, nickname: N.mengao, color: '#c02a1e', crest: '/crests/flamengo.png' },
  estudiantes: {
    name: N.estudiantes,
    nickname: N.pincha,
    // vermelho e branco: o branco separa das cores do Flamengo nas barras
    color: '#ececec',
    crest: '/crests/estudiantes.png',
  },
} satisfies Record<string, ShowcaseTeam>;

const BRAZIL: Showcase = {
  market: 'BR',
  timeZone: 'America/Sao_Paulo',
  semi: {
    competition: N.libertadores,
    home: TEAMS.palmeiras,
    away: TEAMS.fluminense,
    score: { home: 0, away: 1 },
    shootout: { home: 5, away: 3 },
    timeline: [
      { minute: 49, kind: 'yellow', side: 'home', player: N.barboza },
      { minute: 56, kind: 'yellow', side: 'away', player: N.hercules },
      { minute: 79, kind: 'sub', side: 'away', in: N.wesley, out: N.canobbio },
      { minute: 82, kind: 'goal', side: 'away', player: N.hercules, assist: N.wesley },
      { minute: 87, kind: 'sub', side: 'away', in: N.acosta, out: N.ganso },
      { minute: null, kind: 'decisive', side: 'home', player: N.marlon },
    ],
    stats: [
      { key: 'possession', home: 54, away: 46, unit: '%' },
      { key: 'xg', home: 0.64, away: 0.24, unit: '' },
      { key: 'shots', home: 12, away: 4, unit: '' },
      { key: 'passes', home: 483, away: 446, unit: '' },
      { key: 'corners', home: 2, away: 4, unit: '' },
    ],
    relevance: [
      { market: 'BR', score: 100, reason: 'reasonBR' },
      { market: 'AR', score: 100, reason: 'reasonAR' },
      { market: 'UY', score: 98 },
      { market: 'CL', score: 98 },
      { market: 'CO', score: 98 },
      { market: 'MX', score: 80 },
    ],
  },
  round: {
    competition: N.brasileirao,
    startsAt: '2026-10-24T21:30:00Z',
    home: TEAMS.palmeiras,
    away: TEAMS.bragantino,
    watch: [
      { medium: 'free_tv', count: 2 },
      { medium: 'pay_tv', count: 1 },
      { medium: 'streaming', count: 2 },
      { medium: 'youtube', count: 2 },
    ],
    stakes: [
      { team: 'home', key: 's1' },
      { team: 'home', key: 's2' },
      { team: 'home', key: 's5' },
      { team: 'home', key: 's3' },
      { team: 'away', key: 's3' },
      { team: 'away', key: 's4', warn: true },
    ],
  },
  h2h: {
    played: 34,
    draws: 5,
    home: { ...TEAMS.palmeiras, wins: 14, goals: 42 },
    away: { ...TEAMS.fluminense, wins: 15, goals: 35 },
    meetings: [
      {
        date: '2026-10-22',
        competition: N.libertadores,
        stage: 'semiSecondLeg',
        home: 'home',
        score: [0, 1],
        penalties: [5, 3],
      },
      { date: '2026-10-15', competition: N.libertadores, stage: 'semiFirstLeg', home: 'away', score: [1, 2] },
      {
        date: '2026-08-15',
        competition: N.brasileirao,
        stage: 'round',
        round: 23,
        home: 'away',
        score: [3, 2],
      },
      {
        date: '2026-02-26',
        competition: N.brasileirao,
        stage: 'round',
        round: 4,
        home: 'home',
        score: [2, 1],
      },
    ],
  },
  finalist: TEAMS.palmeiras,
};

const ARGENTINA: Showcase = {
  market: 'AR',
  timeZone: 'America/Argentina/Buenos_Aires',
  semi: {
    competition: N.libertadores,
    home: TEAMS.flamengo,
    away: TEAMS.estudiantes,
    score: { home: 0, away: 0 },
    shootout: { home: 2, away: 3 },
    timeline: [
      { minute: 35, kind: 'yellow', side: 'away', player: N.gallego },
      { minute: 50, kind: 'red', side: 'away', player: N.gallego },
      { minute: 64, kind: 'sub', side: 'home', in: N.arrascaeta, out: N.carrascal },
      { minute: 82, kind: 'sub', side: 'home', in: N.brunoHenrique, out: N.pulgar },
      { minute: 90, kind: 'sub', side: 'away', in: N.sosa, out: N.castro },
      { minute: null, kind: 'decisiveMiss', side: 'home', player: N.brunoHenrique },
    ],
    stats: [
      { key: 'possession', home: 76, away: 24, unit: '%' },
      { key: 'xg', home: 0.94, away: 0.85, unit: '' },
      { key: 'shots', home: 13, away: 8, unit: '' },
      { key: 'passes', home: 578, away: 135, unit: '' },
      { key: 'corners', home: 6, away: 5, unit: '' },
    ],
    relevance: [
      { market: 'AR', score: 100, reason: 'reasonAR' },
      { market: 'BR', score: 100, reason: 'reasonBR' },
      { market: 'UY', score: 98 },
      { market: 'CL', score: 98 },
      { market: 'CO', score: 98 },
      { market: 'MX', score: 80 },
    ],
  },
  round: {
    competition: N.libertadores,
    startsAt: '2026-11-28T15:00:00Z',
    home: TEAMS.palmeiras,
    away: TEAMS.estudiantes,
    watch: [
      { medium: 'free_tv', count: 1 },
      { medium: 'pay_tv', count: 2 },
      { medium: 'streaming', count: 1 },
    ],
    stakes: [
      { team: 'home', key: 's1' },
      { team: 'away', key: 's2' },
      { team: 'both', key: 's3' },
      { team: 'both', key: 's4' },
      { team: 'both', key: 's5' },
    ],
  },
  h2h: {
    played: 6,
    draws: 3,
    home: { ...TEAMS.flamengo, wins: 2, goals: 4 },
    away: { ...TEAMS.estudiantes, wins: 1, goals: 3 },
    meetings: [
      {
        date: '2026-10-22',
        competition: N.libertadores,
        stage: 'semiSecondLeg',
        home: 'home',
        score: [0, 0],
        penalties: [2, 3],
      },
      { date: '2026-10-16', competition: N.libertadores, stage: 'semiFirstLeg', home: 'away', score: [0, 0] },
      {
        date: '2026-05-21',
        competition: N.libertadores,
        stage: 'groupRound',
        round: 5,
        home: 'home',
        score: [1, 0],
      },
      {
        date: '2026-04-30',
        competition: N.libertadores,
        stage: 'groupRound',
        round: 3,
        home: 'away',
        score: [1, 1],
      },
    ],
  },
  finalist: TEAMS.estudiantes,
};

/** Amostra do idioma da página: espanhol mostra a Argentina; português e inglês, o Brasil. */
export const showcase = (locale: Locale): Showcase => (locale === 'es-AR' ? ARGENTINA : BRAZIL);

/** Fusos da agenda: o mesmo jogo no horário de cada mercado. */
export const ZONES = [
  { city: N.saoPaulo, timeZone: 'America/Sao_Paulo', market: 'BR' },
  { city: N.buenosAires, timeZone: 'America/Argentina/Buenos_Aires', market: 'AR' },
  { city: N.bogota, timeZone: 'America/Bogota', market: 'CO' },
  { city: N.mexicoCity, timeZone: 'America/Mexico_City', market: 'MX' },
] as const;

/** Números fixos de configuração (não contagens ao vivo). */
export const HEADLINE = { sports: 12, markets: 11, watch: 8, voices: 7 };

/** Mercados com relevância própria, a voz do conteúdo e se há "onde assistir" no país. */
export const MARKETS = [
  { code: 'BR', voice: 'pt-BR', watch: true },
  { code: 'AR', voice: 'es-AR', watch: true },
  { code: 'UY', voice: 'es-UY', watch: true },
  { code: 'CL', voice: 'es-CL', watch: true },
  { code: 'CO', voice: 'es-CO', watch: true },
  { code: 'PE', voice: 'es-PE', watch: true },
  { code: 'EC', voice: 'es-EC', watch: true },
  { code: 'PY', voice: 'es', watch: false },
  { code: 'BO', voice: 'es', watch: false },
  { code: 'VE', voice: 'es', watch: false },
  { code: 'MX', voice: 'es-MX', watch: true },
] as const;

/**
 * O que cada esporte entrega hoje (levantado no código e nas notas de cada esporte). Hipismo fica fora:
 * a fonte ainda não é licenciada. Os rótulos ficam em `t.landing.sports.tags`.
 */
export const SPORT_TAGS = {
  football: [
    'live',
    'timeline',
    'stats',
    'lineups',
    'whereToWatch',
    'fanTags',
    'stakes',
    'derbies',
    'relevance',
  ],
  basketball: ['results', 'standings', 'byQuarter'],
  nba: ['results', 'standings', 'byQuarter', 'rosters'],
  volleyball: ['results', 'standings', 'bySet'],
  handball: ['results', 'standings', 'byHalf'],
  hockey: ['results', 'overtime', 'byPeriod'],
  rugby: ['results', 'bonus', 'byHalf'],
  'american-football': ['results', 'winPct', 'byQuarter'],
  baseball: ['results', 'winPct', 'byInning'],
  afl: ['results', 'percentage', 'goalsBehinds'],
  mma: ['fightCard', 'fightResult', 'weightClass'],
  'formula-1': ['sessions', 'drivers', 'constructors'],
} as const;
