/**
 * Teto de envios do "Sugerir ou reportar algo": por usuário por hora e, para todos juntos, por dia. Cada envio vira
 * uma issue, então um script com uma sessão de convidado (ou várias) não pode encher a repo. Fica na memória do
 * processo, como o teto dos avisos de vídeo (app/api/related/playback-error/limiter.ts): reiniciar o contêiner só
 * devolve o teto, e o site e o console têm cada um o seu.
 */

export const FEEDBACK_PER_USER = 6;
export const FEEDBACK_USER_WINDOW_MS = 60 * 60_000;
export const FEEDBACK_PER_DAY = 150;
export const FEEDBACK_DAY_MS = 24 * 60 * 60_000;

export class FeedbackLimiter {
  private readonly byUser = new Map<string, number[]>();
  private all: number[] = [];

  constructor(
    private readonly perUser = FEEDBACK_PER_USER,
    private readonly userWindowMs = FEEDBACK_USER_WINDOW_MS,
    private readonly perDay = FEEDBACK_PER_DAY,
    private readonly dayMs = FEEDBACK_DAY_MS,
  ) {}

  /** Reserva um envio; `false` quando o usuário (ou o total do dia) já chegou ao teto. */
  take(userId: string, now = Date.now()): boolean {
    const since = now - this.userWindowMs;
    for (const [user, times] of this.byUser) {
      const kept = times.filter((t) => t > since);
      if (kept.length) this.byUser.set(user, kept);
      else this.byUser.delete(user);
    }
    this.all = this.all.filter((t) => t > now - this.dayMs);
    const recent = this.byUser.get(userId) ?? [];
    if (recent.length >= this.perUser || this.all.length >= this.perDay) return false;
    recent.push(now);
    this.byUser.set(userId, recent);
    this.all.push(now);
    return true;
  }

  /** Devolve a reserva de um envio que não chegou ao GitHub. */
  release(userId: string, at: number) {
    const recent = this.byUser.get(userId);
    const i = recent?.indexOf(at) ?? -1;
    if (recent && i >= 0) recent.splice(i, 1);
    const j = this.all.indexOf(at);
    if (j >= 0) this.all.splice(j, 1);
  }
}
