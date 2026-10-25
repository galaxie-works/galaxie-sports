/**
 * Perfil de cache (`cacheLife`) das leituras de placar e tabela: o que ainda pode mudar fica em `minutes`
 * (o jogo encerrado aparece com o placar em poucos minutos); temporada e janela passadas ficam em `hours`.
 * Módulo puro, para os testes. Cada fetcher chama `cacheLife` com o literal (os perfis são overloads).
 */

const DAY = 86_400_000;

/**
 * Temporada que ainda pode mudar: sem `season` (a atual da API), a do ano corrente ou a anterior (a 2025 de
 * uma 2025/26 em andamento).
 */
export function isLiveSeason(season: number | undefined, now = new Date()): boolean {
  return season === undefined || season >= now.getUTCFullYear() - 1;
}

/**
 * Janela de jogos (`to`, data ou instante ISO) que termina há menos de 2 dias: os jogos de ontem ainda
 * recebem placar (esportes sem ao vivo têm o resultado no sync do dia seguinte). Data ilegível conta como
 * recente.
 */
export function isRecentWindow(to: string, now = new Date()): boolean {
  return !(Date.parse(to) < now.getTime() - 2 * DAY);
}
