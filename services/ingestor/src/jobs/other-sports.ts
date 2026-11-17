import type { ApiSport } from '@galaxie/apisports-client';

/**
 * Agenda diária das outras 11 APIs (cada uma com cota própria): 1 chamada = todas as ligas do dia. Fica fora do
 * daily-job.ts para o fechamento pós-jogo (postgame/plan.ts), que roda a cada minuto, não carregar o job inteiro.
 */
export const OTHER_SPORTS_SCHEDULE: Record<Exclude<ApiSport, 'football'>, string> = {
  afl: '/games',
  baseball: '/games',
  basketball: '/games',
  'formula-1': '/races',
  handball: '/games',
  hockey: '/games',
  mma: '/fights',
  nba: '/games',
  'american-football': '/games',
  rugby: '/games',
  volleyball: '/games',
};
