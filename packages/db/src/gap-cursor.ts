/**
 * Marca d'água tolerante a lacunas sobre `ops.change_feed`.
 *
 * Os IDs (bigserial) são atribuídos no INSERT, mas a linha só fica visível no COMMIT: uma transação
 * mais lenta pode tornar visível o ID 10 depois que o 11 já foi lido. Ler sempre `id > último lido`
 * perderia o 10. Aqui o piso (`floor`) só avança sobre IDs contíguos já processados; IDs acima do
 * piso ficam em `seen` e não são reprocessados. Uma lacuna que persiste além de `gapTimeoutMs`
 * (transação revertida, sequência pulada) é abandonada.
 */
export class GapCursor {
  private readonly seen = new Set<number>();
  private gap: { id: number; since: number } | undefined;
  private readonly gapTimeoutMs: number;
  private readonly maxSeen: number;
  private readonly now: () => number;

  constructor(
    /** Todos os IDs ≤ floor já foram processados (ou abandonados). */
    public floor: number,
    options: { gapTimeoutMs?: number; maxSeen?: number; now?: () => number } = {},
  ) {
    this.gapTimeoutMs = options.gapTimeoutMs ?? 10_000;
    this.maxSeen = options.maxSeen ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** IDs acima do piso já processados — excluídos da próxima leitura. */
  get seenIds(): number[] {
    return [...this.seen];
  }

  isNew(id: number): boolean {
    return id > this.floor && !this.seen.has(id);
  }

  /** Marca IDs como processados e avança o piso o quanto for possível. */
  mark(ids: Iterable<number>): void {
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
      if (this.gap?.id !== missing) this.gap = { id: missing, since: t };
      const expired = t - this.gap.since >= this.gapTimeoutMs;
      // proteção de memória: muitas linhas acima de uma lacuna antiga também a encerram
      if (!expired && this.seen.size < this.maxSeen) return;
      // abandona a lacuna: pula até o próximo ID visto
      this.floor = Math.min(...this.seen) - 1;
      this.gap = undefined;
    }
  }
}
