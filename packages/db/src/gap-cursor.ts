/**
 * Espera padrão por um ID pulado antes de abandoná-lo. Uma transação longa do ingestor (lote grande, carga
 * inicial) segura o ID até o COMMIT; com 10 s o SSE e os webhooks perdiam essas mudanças. Esperar não atrasa
 * nada: as linhas acima da lacuna são entregues assim que aparecem, só o piso fica parado.
 */
export const GAP_TIMEOUT_MS = 90_000;

/** IDs acima de uma lacuna guardados antes de encerrá-la à força (vão no `NOT IN` da leitura). */
export const GAP_MAX_SEEN = 20_000;

/** Uma lacuna abandonada: IDs `from`..`to` nunca vistos (transação revertida, sequência pulada ou atraso). */
export interface AbandonedGap {
  from: number;
  to: number;
  /** `timeout`: venceu e continuou faltando na releitura; `max_seen`: proteção de memória. */
  reason: 'timeout' | 'max_seen';
  /** Quanto tempo a lacuna esperou (ms). */
  waitedMs: number;
}

/**
 * Marca d'água tolerante a lacunas sobre `ops.change_feed`.
 *
 * Os IDs (bigserial) são atribuídos no INSERT, mas a linha só fica visível no COMMIT: uma transação
 * mais lenta pode tornar visível o ID 10 depois que o 11 já foi lido. Ler sempre `id > último lido`
 * perderia o 10. Aqui o piso (`floor`) só avança sobre IDs contíguos já processados; IDs acima do
 * piso ficam em `seen` e não são reprocessados. Uma lacuna que persiste além de `gapTimeoutMs`
 * (transação revertida, sequência pulada) é abandonada, mas só depois de uma leitura que começou após o
 * vencimento (o `mark` seguinte): o COMMIT que cai entre a última leitura e o vencimento ainda é pego.
 * Cada abandono vai para `onAbandon` (log e métrica).
 */
export class GapCursor {
  private readonly seen = new Set<number>();
  private gap: { id: number; since: number; expired: boolean; reread: boolean } | undefined;
  private readonly gapTimeoutMs: number;
  private readonly maxSeen: number;
  private readonly now: () => number;
  private readonly onAbandon: ((gap: AbandonedGap) => void) | undefined;

  constructor(
    /** Todos os IDs ≤ floor já foram processados (ou abandonados). */
    public floor: number,
    options: {
      gapTimeoutMs?: number;
      maxSeen?: number;
      now?: () => number;
      onAbandon?: (gap: AbandonedGap) => void;
    } = {},
  ) {
    this.gapTimeoutMs = options.gapTimeoutMs ?? GAP_TIMEOUT_MS;
    this.maxSeen = options.maxSeen ?? GAP_MAX_SEEN;
    this.now = options.now ?? Date.now;
    this.onAbandon = options.onAbandon;
  }

  /** IDs acima do piso já processados — excluídos da próxima leitura. */
  get seenIds(): number[] {
    return [...this.seen];
  }

  isNew(id: number): boolean {
    return id > this.floor && !this.seen.has(id);
  }

  /**
   * Marca IDs como processados e avança o piso o quanto for possível. Chame depois de cada leitura do change
   * feed, mesmo vazia: é ela que conta como a releitura de uma lacuna vencida.
   */
  mark(ids: Iterable<number>): void {
    if (this.gap?.expired) this.gap.reread = true;
    for (const id of ids) if (id > this.floor) this.seen.add(id);
    this.advance();
  }

  /** Reavalia lacunas vencidas (chame periodicamente, mesmo sem linhas novas). */
  advance(): void {
    for (;;) {
      while (this.seen.delete(this.floor + 1)) this.floor += 1;
      if (!this.seen.size) {
        this.gap = undefined;
        return;
      }
      const missing = this.floor + 1;
      const t = this.now();
      if (this.gap?.id !== missing) this.gap = { id: missing, since: t, expired: false, reread: false };
      // proteção de memória: muitas linhas acima de uma lacuna antiga também a encerram
      const overflow = this.seen.size >= this.maxSeen;
      if (!overflow) {
        if (t - this.gap.since < this.gapTimeoutMs) return;
        // venceu: espera a próxima leitura (o `mark` seguinte) antes de desistir
        this.gap.expired = true;
        if (!this.gap.reread) return;
      }
      // abandona a lacuna: pula até o próximo ID visto
      const next = Math.min(...this.seen);
      this.onAbandon?.({
        from: missing,
        to: next - 1,
        reason: overflow ? 'max_seen' : 'timeout',
        waitedMs: t - this.gap.since,
      });
      this.floor = next - 1;
      this.gap = undefined;
    }
  }
}
