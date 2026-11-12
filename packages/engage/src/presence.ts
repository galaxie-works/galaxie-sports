/**
 * Presença ao vivo verificada (#906, B9): "o torcedor estava lá". O widget (ou o app do cliente) manda um sinal a
 * cada `PRESENCE_HEARTBEAT_S` enquanto o jogo está visível; o servidor grava janelas de presença pelo relógio dele.
 * Aqui só as regras, sem banco nem Valkey.
 *
 * - **Só aba visível conta.** Sinal com a aba oculta não abre nem estende janela.
 * - **Interação ocasional.** Sem interação há mais de `PRESENCE_INTERACTION_EVERY_S`, o sinal deixa de contar até
 *   o torcedor interagir (o widget pede um toque); robô que só manda sinal para de somar. O `interacted` é a palavra
 *   do widget: é uma barreira contra aba esquecida e robô simples, não contra quem forja o sinal.
 * - **Limite de jogos ao mesmo tempo** por Perfil: padrão da Galaxie no painel, que o cliente só pode baixar.
 * - **Relógio do aparelho nunca vale**, e quem chega depois do evento não ganha o evento.
 */

/** Intervalo pedido ao widget entre um sinal e outro. */
export const PRESENCE_HEARTBEAT_S = 30;
/** Sem sinal por mais que isto, a janela fecha; o próximo sinal abre outra. */
export const PRESENCE_GAP_S = 90;
/** De quanto em quanto tempo o widget pede um toque do torcedor. */
export const PRESENCE_INTERACTION_EVERY_S = 15 * 60;
/** Jogos ao mesmo tempo por Perfil: padrão e teto da Galaxie (o painel pode mudar dentro de 1 a 10). */
export const PRESENCE_MAX_GAMES_DEFAULT = 3;
export const PRESENCE_MAX_GAMES_CEILING = 10;
/** Dias que as janelas ficam guardadas depois do último sinal (dado pessoal; o expurgo roda de hora em hora). */
export const PRESENCE_RETENTION_DAYS = 90;

/** O limite que vale para o cliente: o dele, se for menor que o da Galaxie. */
export function presenceMaxGames(
  galaxie: number | null | undefined,
  client: number | null | undefined,
): number {
  const g =
    galaxie && Number.isInteger(galaxie)
      ? Math.min(PRESENCE_MAX_GAMES_CEILING, Math.max(1, galaxie))
      : PRESENCE_MAX_GAMES_DEFAULT;
  return client && Number.isInteger(client) && client >= 1 ? Math.min(g, client) : g;
}

export type HeartbeatVerdict = 'counted' | 'hidden' | 'interaction_needed';

/**
 * O sinal conta? `lastInteractionAt` é o último toque registrado pelo servidor no jogo, em qualquer janela (null =
 * nunca), `windowStartedAt` o começo da janela aberta (null = vai abrir agora). A primeira janela do jogo conta;
 * abrir outra depois de sumir 90 s não zera o relógio da interação (senão o robô só pararia de mandar sinal).
 */
export function heartbeatVerdict(input: {
  visible: boolean;
  interacted: boolean;
  lastInteractionAt: number | null;
  windowStartedAt: number | null;
  now: number;
}): HeartbeatVerdict {
  if (!input.visible) return 'hidden';
  if (input.interacted) return 'counted';
  const since = input.lastInteractionAt ?? input.windowStartedAt;
  if (since === null) return 'counted';
  return input.now - since > PRESENCE_INTERACTION_EVERY_S * 1000 ? 'interaction_needed' : 'counted';
}

/** O widget deve pedir um toque agora? (antes de o sinal parar de contar, com um minuto de folga) */
export const interactionDue = (lastInteractionAt: number, now: number) =>
  now - lastInteractionAt >= (PRESENCE_INTERACTION_EVERY_S - 60) * 1000;

export interface PresenceWindow {
  startedAt: number;
  lastSeenAt: number;
}

/**
 * Estava presente no instante do evento? Vale a janela que começou antes (ou no instante) e durou até ele, com a
 * folga de um intervalo de sinal depois do último (o sinal seguinte ainda não chegou). Quem abriu depois não ganha.
 */
export function wasPresent(windows: readonly PresenceWindow[], at: number): boolean {
  const slack = PRESENCE_HEARTBEAT_S * 1000;
  return windows.some((w) => w.startedAt <= at && at <= w.lastSeenAt + slack);
}
