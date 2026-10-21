/**
 * Purge na CDN por tag. A API marca cada resposta com `surrogate-key` (tags separadas por espaço);
 * a implementação concreta (purge por Surrogate-Key ou Cache-Tag) entra quando a CDN for escolhida.
 */
export interface CdnPurger {
  purgeTags(tags: string[]): Promise<void>;
}

export class NoopCdnPurger implements CdnPurger {
  async purgeTags(): Promise<void> {}
}

/** Registra as tags purgadas (útil em testes e para auditar a propagação). */
export class RecordingCdnPurger implements CdnPurger {
  readonly purged: string[][] = [];
  async purgeTags(tags: string[]): Promise<void> {
    this.purged.push(tags);
  }
}
