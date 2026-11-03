/**
 * Teto de jobs simultâneos do scheduler (SCHEDULER_MAX_JOBS): cada job é um processo Node com heap próprio, e a
 * soma tem de caber no mem_limit do contêiner. Quem chega com as vagas ocupadas espera na fila, na ordem de
 * chegada; a vaga de quem termina passa direto para o próximo.
 */
export class JobSlots {
  private active = 0;
  private closed = false;
  private readonly waiting: ((granted: boolean) => void)[] = [];

  constructor(readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error(`teto de jobs simultâneos inválido: ${max}`);
  }

  /** Vagas ocupadas agora. */
  get running(): number {
    return this.active;
  }

  /** Jobs esperando vaga. */
  get queued(): number {
    return this.waiting.length;
  }

  /** Espera uma vaga; devolve quem a solta (idempotente) ou `null` se o scheduler fechou a fila antes. */
  async acquire(): Promise<(() => void) | null> {
    if (this.closed) return null;
    if (this.active < this.max) {
      this.active++;
      return this.releaser();
    }
    const granted = await new Promise<boolean>((resolve) => this.waiting.push(resolve));
    return granted ? this.releaser() : null;
  }

  /** Encerramento: quem está na fila desiste (não começa um job novo com o scheduler saindo). */
  close(): void {
    this.closed = true;
    for (const resolve of this.waiting.splice(0)) resolve(false);
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      // a vaga passa direto: `active` não muda
      if (next) next(true);
      else this.active--;
    };
  }
}
