/**
 * Purge na CDN por tag. A API marca cada resposta com `surrogate-key` (tags separadas por espaço) e `Cache-Tag`
 * (separadas por vírgula, o formato da Cloudflare). Em produção, com `CLOUDFLARE_ZONE_ID` e
 * `CLOUDFLARE_PURGE_TOKEN`, vale o `CloudflareCdnPurger` (./cloudflare-purger.ts); sem eles, o `NoopCdnPurger`.
 */
export interface CdnPurger {
  /** Pede o purge das tags. Não lança: falha da CDN não pode travar o purge do Valkey nem o change feed. */
  purgeTags(tags: string[]): Promise<void>;
  /** Para os timers e espera o envio em andamento (fechamento da API). */
  close?(): Promise<void>;
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
