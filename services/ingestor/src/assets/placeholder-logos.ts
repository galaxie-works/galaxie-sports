import { sql } from 'drizzle-orm';
import type { MediaAssetKind } from '@galaxie/apisports-client';
import { asset } from '@galaxie/db';
import { PLACEHOLDER_LOGO_SHA256 } from './palette.js';
import { PERSON_PHOTO_KINDS } from './person-photos.js';

/** Kinds de core.asset que são logo de time ou de competição (o placeholder vira "sem logo"). */
export const LOGO_KIND_VALUES = ['team_logo', 'league_logo'] as const satisfies readonly MediaAssetKind[];
export const LOGO_KINDS: ReadonlySet<string> = new Set(LOGO_KIND_VALUES);

/**
 * Kinds cujo asset ausente (404, bloqueado ou imagem genérica) deixa a entidade sem imagem: a normalização
 * não religa e a API não cai na URL de origem, que é o próprio placeholder ou um 404.
 */
export const DETACHED_WHEN_MISSING_KINDS: ReadonlySet<string> = new Set([
  ...PERSON_PHOTO_KINDS,
  ...LOGO_KINDS,
]);

/** Asset já tentado pelo Asset Mirror e sem arquivo (404, bloqueado ou imagem genérica). */
export const MISSING_ASSET = sql<boolean>`(${asset.storageKey} is null and ${asset.fetchedAt} is not null)`;

/** O escudo baixado é uma das imagens genéricas do fornecedor ("image not available" etc.)? */
export function isPlaceholderLogo(
  kind: string,
  sha256: string,
  placeholders: ReadonlySet<string> = PLACEHOLDER_LOGO_SHA256,
): boolean {
  return LOGO_KINDS.has(kind) && placeholders.has(sha256);
}
