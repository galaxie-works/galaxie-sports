/** Tipos e limites de Ajustes → Escudos que o navegador também usa (sem nada do servidor). */

export const CREST_TARGET_TYPES = ['team', 'competition'] as const;
export type CrestTargetType = (typeof CREST_TARGET_TYPES)[number];

export const CREST_KIND_FILTERS = ['all', 'team', 'competition'] as const;
export type CrestKindFilter = (typeof CREST_KIND_FILTERS)[number];

/** De onde vem o escudo que vale hoje: enviado no painel, do acervo importado, do fornecedor, ou nenhum. */
export type CrestSource = 'panel' | 'acervo' | 'provider' | null;

/** Teto do arquivo no navegador, o mesmo do servidor (`CREST_MAX_BYTES` de `@galaxie/crests`). */
export const CREST_MAX_MB = 5;
/** Lado mínimo de PNG/WebP (`CREST_MIN_PX`). */
export const CREST_MIN_PX = 128;
export const CREST_ACCEPT = 'image/svg+xml,image/png,image/webp,.svg,.png,.webp';

export interface CrestRow {
  type: CrestTargetType;
  id: string;
  name: string;
  country: string | null;
  source: CrestSource;
  /** O escudo que vale hoje (do painel ou do acervo, senão o do fornecedor). */
  logoUrl: string | null;
  /** O do fornecedor, que volta quando não há escudo do acervo nem do painel. */
  providerUrl: string | null;
  /** Último envio no painel ainda valendo. */
  lastUpload: { by: string; at: string } | null;
  /** O escudo de hoje é o do último envio, então Voltar desfaz. */
  canRevert: boolean;
}

export const isCrestTargetType = (v: unknown): v is CrestTargetType =>
  typeof v === 'string' && (CREST_TARGET_TYPES as readonly string[]).includes(v);

/** Ids do cadastro são uuid. */
export const isCrestTargetId = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function parseCrestKind(v: unknown): CrestKindFilter {
  return typeof v === 'string' && (CREST_KIND_FILTERS as readonly string[]).includes(v)
    ? (v as CrestKindFilter)
    : 'all';
}
