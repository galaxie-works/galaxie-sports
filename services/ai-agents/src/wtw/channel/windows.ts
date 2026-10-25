/**
 * Janelas do canal do jogo (docs/07 §2.2.4), por rodada:
 *
 *   T-5d   antes do primeiro jogo da rodada — a escala costuma sair uma semana antes
 *   T-48h  idem, para pegar a escala definitiva e as mudanças da semana
 *   T-6h   antes do primeiro jogo de cada DIA da rodada — troca de última hora
 *   post   3 h depois do último jogo do dia, até 72 h — quem de fato transmitiu
 *
 * Uma chamada cobre todos os jogos e mercados do grupo (competição × rodada × janela × dia). Janela
 * perdida não é recuperada: a vigente é a que abriu por último.
 */

export type ChannelWindowName = 'T-5d' | 'T-48h' | 'T-6h' | 'post';

export interface ChannelWindow {
  window: ChannelWindowName;
  phase: 'pre' | 'post';
  /** `round` (T-5d, T-48h) ou o dia da rodada (T-6h, post). */
  bucket: string;
  opensAt: Date;
}

const H = 3_600_000;

export const CHANNEL_PRE_WINDOWS: { window: ChannelWindowName; offsetMs: number; anchor: 'round' | 'day' }[] =
  [
    { window: 'T-5d', offsetMs: 120 * H, anchor: 'round' },
    { window: 'T-48h', offsetMs: 48 * H, anchor: 'round' },
    { window: 'T-6h', offsetMs: 6 * H, anchor: 'day' },
  ];

export const CHANNEL_POST_OPENS_MS = 3 * H;
export const CHANNEL_POST_CLOSES_MS = 72 * H;
/** Horizonte dos jogos futuros considerados (a maior janela + folga). */
export const CHANNEL_HORIZON_MS = 120 * H + 10 * 60_000;

const PRE_STATUSES = new Set(['scheduled', 'starting']);
const POST_STATUSES = new Set(['finished', 'abandoned']);

/**
 * Dia da rodada do jogo: a data UTC 6 h antes do início (o jogo das 21h30 de Brasília, 00h30 UTC,
 * fica no dia em que é jogado nas Américas).
 */
export const dayBucket = (startsAt: Date) => new Date(startsAt.getTime() - 6 * H).toISOString().slice(0, 10);

export interface WindowAnchors {
  /** Início do primeiro jogo da rodada. */
  roundStart: Date;
  /** Início do primeiro e do último jogo do dia do jogo (na rodada). */
  dayStart: Date;
  dayLastStart: Date;
}

/** Janela vigente do jogo agora, ou null (fora das janelas, já iniciado sem ter terminado...). */
export function dueChannelWindow(
  e: { startsAt: Date; status: string },
  anchors: WindowAnchors,
  now: Date,
): ChannelWindow | null {
  const t = now.getTime();
  const start = e.startsAt.getTime();
  if (POST_STATUSES.has(e.status)) {
    const opens = anchors.dayLastStart.getTime() + CHANNEL_POST_OPENS_MS;
    if (t >= opens && t <= start + CHANNEL_POST_CLOSES_MS)
      return { window: 'post', phase: 'post', bucket: dayBucket(e.startsAt), opensAt: new Date(opens) };
    return null;
  }
  if (!PRE_STATUSES.has(e.status) || t >= start) return null;
  let due: ChannelWindow | null = null;
  for (const w of CHANNEL_PRE_WINDOWS) {
    const anchor =
      w.anchor === 'round'
        ? Math.min(anchors.roundStart.getTime(), start)
        : Math.min(anchors.dayStart.getTime(), start);
    const opensAt = anchor - w.offsetMs;
    if (t >= opensAt && (!due || opensAt >= due.opensAt.getTime()))
      due = {
        window: w.window,
        phase: 'pre',
        bucket: w.anchor === 'round' ? 'round' : dayBucket(e.startsAt),
        opensAt: new Date(opensAt),
      };
  }
  return due;
}
