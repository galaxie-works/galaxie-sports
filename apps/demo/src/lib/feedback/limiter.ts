/**
 * Teto de envios do "Sugerir ou reportar algo" por usuário: cada envio vira uma issue, então um script com uma
 * sessão de convidado não pode encher o repositório. Fica na memória do processo, como o teto dos avisos de vídeo
 * (app/api/related/playback-error/limiter.ts); reiniciar o contêiner só devolve o teto.
 */

export const FEEDBACK_PER_WINDOW = 6;
export const FEEDBACK_WINDOW_MS = 60 * 60_000;

export class FeedbackLimiter {
  private readonly byUser = new Map<string, number[]>();

  constructor(
    private readonly max = FEEDBACK_PER_WINDOW,
    private readonly windowMs = FEEDBACK_WINDOW_MS,
  ) {}

  /** Reserva um envio; `false` quando o usuário já chegou ao teto na janela. */
  take(userId: string, now = Date.now()): boolean {
    const since = now - this.windowMs;
    for (const [user, times] of this.byUser) {
      const kept = times.filter((t) => t > since);
      if (kept.length) this.byUser.set(user, kept);
      else this.byUser.delete(user);
    }
    const recent = this.byUser.get(userId) ?? [];
    if (recent.length >= this.max) return false;
    recent.push(now);
    this.byUser.set(userId, recent);
    return true;
  }

  /** Devolve a reserva de um envio que não chegou ao GitHub. */
  release(userId: string, at: number) {
    const recent = this.byUser.get(userId);
    const i = recent?.indexOf(at) ?? -1;
    if (recent && i >= 0) recent.splice(i, 1);
  }
}
