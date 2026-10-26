/**
 * Teto dos avisos de vídeo recusado por usuário da demo. Todos os usuários (inclusive convidados) falam com
 * a API pela mesma chave, então para a API são um tenant só: sem teto, um convidado esvaziaria a vitrine da
 * demo inteira repetindo o aviso com ids diferentes. Fica na memória do processo (a demo roda um processo
 * por contêiner); reiniciar zera a contagem, o que só devolve o teto, nunca abre o bloqueio de todos.
 */

/** Avisos por usuário na janela. Um vídeo recusado gera um aviso; uma sessão normal fica bem abaixo disso. */
export const PLAYBACK_REPORTS_PER_WINDOW = 10;
export const PLAYBACK_REPORT_WINDOW_MS = 60 * 60_000;

export type PlaybackReportVerdict = 'ok' | 'duplicate' | 'limited';

export class PlaybackReportLimiter {
  /** usuário → instantes dos avisos aceitos na janela. */
  private readonly byUser = new Map<string, number[]>();
  /** `usuário|item` → instante do aviso aceito. */
  private readonly byItem = new Map<string, number>();

  constructor(
    private readonly max = PLAYBACK_REPORTS_PER_WINDOW,
    private readonly windowMs = PLAYBACK_REPORT_WINDOW_MS,
  ) {}

  /** Conta o aviso do usuário para o item: `duplicate` (o mesmo item na janela) e `limited` não passam. */
  take(userId: string, itemId: string, now = Date.now()): PlaybackReportVerdict {
    this.prune(now);
    if (this.byItem.has(`${userId}|${itemId}`)) return 'duplicate';
    const recent = this.byUser.get(userId) ?? [];
    if (recent.length >= this.max) return 'limited';
    recent.push(now);
    this.byUser.set(userId, recent);
    this.byItem.set(`${userId}|${itemId}`, now);
    return 'ok';
  }

  /**
   * Devolve o aviso que não chegou à API (erro de rede ou 5xx): o item não fica marcado como avisado e o
   * teto do usuário não é gasto. Reservar no `take` e devolver aqui evita dois repasses simultâneos.
   */
  release(userId: string, itemId: string, at: number) {
    if (this.byItem.get(`${userId}|${itemId}`) === at) this.byItem.delete(`${userId}|${itemId}`);
    const recent = this.byUser.get(userId);
    const i = recent?.indexOf(at) ?? -1;
    if (recent && i >= 0) recent.splice(i, 1);
  }

  private prune(now: number) {
    const since = now - this.windowMs;
    for (const [user, times] of this.byUser) {
      const kept = times.filter((t) => t > since);
      if (kept.length) this.byUser.set(user, kept);
      else this.byUser.delete(user);
    }
    for (const [k, t] of this.byItem) if (t <= since) this.byItem.delete(k);
  }
}
