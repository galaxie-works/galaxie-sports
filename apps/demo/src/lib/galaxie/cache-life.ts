/**
 * Perfil de cache (`cacheLife`) das leituras de placar e tabela. O que ainda pode mudar (temporada em
 * andamento, jogo perto) fica em `ACTIVE_LIFE`, revalidado a cada 5 minutos: o jogo encerrado aparece com o
 * placar sem esperar a hora cheia, e a temporada inteira de jogos (até 10 páginas de 200) não é pedida de
 * novo a cada minuto. Temporada encerrada e time sem jogo perto seguem em `hours`. Módulo puro, para os testes.
 */

const DAY = 86_400_000;

/** Revalida a cada 5 minutos; a entrada velha ainda serve por até 1 dia enquanto a nova chega. */
export const ACTIVE_LIFE = { stale: 300, revalidate: 300, expire: 86_400 };

/** Instante ilegível conta como perto (na dúvida, o cache mais curto). */
const near = (instant: string, now: Date, days: number) => {
  const t = Date.parse(instant);
  return Number.isNaN(t) || Math.abs(t - now.getTime()) <= days * DAY;
};

/**
 * Janela de jogos (`from`–`to`, data ou instante ISO) em andamento: começou (ou começa em até 2 dias) e
 * terminou há menos de 2 dias (os jogos de ontem ainda recebem placar: esportes sem ao vivo têm o resultado
 * no sync do dia seguinte). Data ilegível conta como em andamento.
 */
export function isActiveWindow(from: string, to: string, now = new Date()): boolean {
  return !(Date.parse(from) > now.getTime() + 2 * DAY) && !(Date.parse(to) < now.getTime() - 2 * DAY);
}

/**
 * Tabela em andamento: atualizada nos últimos 14 dias (uma rodada por semana, com folga para a pausa de
 * datas FIFA). A de uma temporada encerrada (o Brasileirão 2025 lido em 2026) fica parada e vai para `hours`.
 */
export function isActiveStandings(updatedAt: string | null | undefined, now = new Date()): boolean {
  return updatedAt != null && near(updatedAt, now, 14);
}

/** Time com jogo perto: ao vivo, o próximo em até 2 dias ou o último há menos de 2 dias. */
export function hasNearMatch(
  overview: {
    live_event: unknown;
    next_event: { starts_at: string } | null;
    last_events: { starts_at: string }[];
  },
  now = new Date(),
): boolean {
  if (overview.live_event) return true;
  const next = overview.next_event?.starts_at;
  return (next != null && near(next, now, 2)) || overview.last_events.some((e) => near(e.starts_at, now, 2));
}
