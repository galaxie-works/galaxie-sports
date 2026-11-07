/**
 * Mapa de frescor do raw: cada endpoint da api-sports que usamos, o job que o renova e de quantos em quantos dias
 * ele volta. É a fonte do alerta `RawEndpointOverdue` (métricas `galaxie_raw_endpoint_*`) e da tabela "Mapa de
 * frescor" em docs/03 §11.1: os dois têm que andar juntos.
 *
 * `periodDays` é o período do item mais frequente do endpoint (tier 1, temporada em jogo). Com vários itens no
 * rodízio, o endpoint é tocado ao menos nesse intervalo; a última busca dele no raw (`last_seen_at` ou
 * `fetched_at`) mais antiga que isso, com folga de meio dia para a duração do job, quer dizer que o job parou ou
 * que o endpoint saiu da fila.
 */
export interface RawCadence {
  sport: string;
  endpoint: string;
  /** Período do item mais frequente (dias). */
  periodDays: number;
  /** Job do scheduler que renova (`ops.job_run.job`). */
  job: string;
}

/** Folga além do período: o job diário roda num horário fixo e pode levar algumas horas. */
export const RAW_CADENCE_SLACK_HOURS = 12;

const football = (endpoint: string, periodDays: number, job: string): RawCadence => ({
  sport: 'football',
  endpoint,
  periodDays,
  job,
});

/** Agenda diária das outras 11 APIs (sync:daily com `--outros-esportes`). */
const OTHER_SPORTS_AGENDA: Record<string, string> = {
  afl: '/games',
  'american-football': '/games',
  baseball: '/games',
  basketball: '/games',
  'formula-1': '/races',
  handball: '/games',
  hockey: '/games',
  mma: '/fights',
  nba: '/games',
  rugby: '/games',
  volleyball: '/games',
};

export const RAW_CADENCE: readonly RawCadence[] = [
  // agenda, detalhe, ao vivo e temporada atual
  football('/fixtures', 1, 'sync:daily'),
  football('/leagues', 1, 'sync:daily'),
  football('/injuries', 1, 'sync:daily'),
  football('/players', 3, 'sync:daily'),
  // rodízio de pessoas tier 1 (sync:daily) e tier 2+ (sync:mirror)
  football('/players/squads', 7, 'sync:daily'),
  football('/coachs', 30, 'sync:daily'),
  football('/transfers', 7, 'sync:daily'),
  football('/trophies', 30, 'sync:daily'),
  football('/sidelined', 2, 'sync:daily'),
  // espelho (sync:mirror), temporada em jogo
  football('/standings', 1, 'sync:mirror'),
  football('/players/topscorers', 1, 'sync:mirror'),
  football('/players/topassists', 1, 'sync:mirror'),
  football('/players/topyellowcards', 3, 'sync:mirror'),
  football('/players/topredcards', 3, 'sync:mirror'),
  football('/fixtures/rounds', 7, 'sync:mirror'),
  football('/teams', 7, 'sync:mirror'),
  football('/venues', 30, 'sync:mirror'),
  // por jogo das próximas 48 h (tier ≤ 2): numa pausa de calendário (data FIFA) o espelho não tem o que buscar; o
  // alerta olha uma semana, não o dia do jogo
  football('/predictions', 7, 'sync:mirror'),
  football('/odds', 7, 'sync:mirror'),
  football('/teams/statistics', 7, 'sync:mirror'),
  football('/fixtures/headtohead', 30, 'sync:mirror'),
  // referência
  ...[
    '/timezone',
    '/countries',
    '/leagues/seasons',
    '/teams/countries',
    '/players/seasons',
    '/odds/bookmakers',
    '/odds/bets',
    '/odds/live/bets',
  ].map((e) => football(e, 7, 'sync:mirror')),
  ...Object.entries(OTHER_SPORTS_AGENDA).map(([sport, endpoint]) => ({
    sport,
    endpoint,
    periodDays: 1,
    job: 'sync:daily',
  })),
];

/** Idade máxima (s) da última busca antes do alerta. */
export function rawCadenceMaxAgeSeconds(c: RawCadence): number {
  return (c.periodDays * 24 + RAW_CADENCE_SLACK_HOURS) * 3600;
}
