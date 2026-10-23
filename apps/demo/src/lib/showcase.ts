/**
 * Amostra de dados reais para os exemplos da apresentação pública, copiada da API em 23/10/2026: a
 * semifinal Palmeiras x Fluminense da Libertadores (lances, pênaltis, estatísticas e relevância por
 * país), Palmeiras x RB Bragantino no Brasileirão (tags do torcedor, o que está em jogo e onde assistir)
 * e o Clássico paisa (retrospecto). Estática de propósito: a página pública não chama a API.
 *
 * Escudos copiados do nosso acervo para `/public/crests` (a página não depende da API nem do bucket);
 * as iniciais na cor do clube ficam de reserva. Sem nomes de canais: o "onde assistir" aparece só pelo
 * tipo de mídia.
 */
import { PROPER_NAMES as N } from './i18n/messages/proper-names';

export interface ShowcaseTeam {
  name: string;
  nickname: string;
  color: string;
  /** Escudo em /public/crests. */
  crest?: string;
}

export type TimelineEntry =
  | { minute: number; kind: 'yellow'; side: 'home' | 'away'; player: string }
  | { minute: number; kind: 'sub'; side: 'home' | 'away'; in: string; out: string }
  | { minute: number; kind: 'goal'; side: 'home' | 'away'; player: string; assist: string }
  | { minute: null; kind: 'decisive'; side: 'home' | 'away'; player: string };

export const SEMI = {
  competition: N.libertadores,
  home: {
    name: N.palmeiras,
    nickname: N.verdao,
    color: '#01713d',
    crest: '/crests/palmeiras.png',
  } satisfies ShowcaseTeam,
  away: {
    name: N.fluminense,
    nickname: N.flu,
    color: '#900028',
    crest: '/crests/fluminense.png',
  } satisfies ShowcaseTeam,
  score: { home: 0, away: 1 },
  shootout: { home: 5, away: 3 },
  timeline: [
    { minute: 49, kind: 'yellow', side: 'home', player: N.barboza },
    { minute: 56, kind: 'yellow', side: 'away', player: N.hercules },
    { minute: 79, kind: 'sub', side: 'away', in: N.wesley, out: N.canobbio },
    { minute: 82, kind: 'goal', side: 'away', player: N.hercules, assist: N.wesley },
    { minute: 87, kind: 'sub', side: 'away', in: N.acosta, out: N.ganso },
    { minute: null, kind: 'decisive', side: 'home', player: N.marlon },
  ] satisfies TimelineEntry[],
  /** Mandante x visitante. */
  stats: [
    { key: 'possession', home: 54, away: 46, unit: '%' },
    { key: 'xg', home: 0.64, away: 0.24, unit: '' },
    { key: 'shots', home: 12, away: 4, unit: '' },
    { key: 'passes', home: 483, away: 446, unit: '' },
    { key: 'corners', home: 2, away: 4, unit: '' },
  ] as const,
  /** Nota 0–100 por mercado (os seis primeiros da lista da API). */
  relevance: [
    { market: 'BR', score: 100, reason: 'reasonBR' },
    { market: 'AR', score: 100, reason: 'reasonAR' },
    { market: 'UY', score: 98 },
    { market: 'CL', score: 98 },
    { market: 'CO', score: 98 },
    { market: 'MX', score: 80 },
  ] as const,
};

export const ROUND = {
  competition: N.brasileirao,
  startsAt: '2026-10-24T21:30:00Z',
  home: {
    name: N.palmeiras,
    nickname: N.verdao,
    color: '#01713d',
    crest: '/crests/palmeiras.png',
  } satisfies ShowcaseTeam,
  away: {
    name: N.bragantino,
    nickname: N.massaBruta,
    color: '#bd2b38',
    crest: '/crests/bragantino.png',
  } satisfies ShowcaseTeam,
  /** Onde assistir no Brasil: opções por tipo de mídia (todas "a confirmar" na amostra). */
  watch: [
    { medium: 'free_tv', count: 2 },
    { medium: 'pay_tv', count: 1 },
    { medium: 'streaming', count: 2 },
    { medium: 'youtube', count: 2 },
  ] as const,
  /** Fusos da agenda: o mesmo jogo no horário de cada mercado. */
  zones: [
    { city: N.saoPaulo, timeZone: 'America/Sao_Paulo', market: 'BR' },
    { city: N.buenosAires, timeZone: 'America/Argentina/Buenos_Aires', market: 'AR' },
    { city: N.bogota, timeZone: 'America/Bogota', market: 'CO' },
    { city: N.mexicoCity, timeZone: 'America/Mexico_City', market: 'MX' },
  ] as const,
};

export const DERBY = {
  intensity: 5,
  matches: 43,
  draws: 17,
  home: {
    name: N.nacional,
    nickname: N.verdolaga,
    color: '#0b8a43',
    crest: '/crests/nacional.png',
    wins: 16,
  },
  away: { name: N.medellin, nickname: N.poderoso, color: '#c8102e', crest: '/crests/medellin.png', wins: 10 },
};

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
