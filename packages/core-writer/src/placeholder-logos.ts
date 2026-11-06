import { sql } from 'drizzle-orm';
import type { MediaAssetKind } from '@galaxie/apisports-client';
import { asset } from '@galaxie/db';

/** Kinds de core.asset que são foto de pessoa (o placeholder vira "sem foto" e a pessoa é desvinculada). */
export const PERSON_PHOTO_KINDS: ReadonlySet<string> = new Set<MediaAssetKind>(['player', 'coach']);

/**
 * Imagens genéricas que o fornecedor serve no lugar do escudo ("image not available", "official logo
 * soon", escudo-contorno cinza), identificadas pelo sha256 — cada uma aparece em dezenas de times.
 * Não têm cor de time: ficam sem paleta (e o backfill não as lê de novo).
 */
export const PLACEHOLDER_LOGO_SHA256: ReadonlySet<string> = new Set([
  '72f0bbb253ab54961cd5d66148e55aceb3e6bc9823da43e57a6e0812e5427430', // image not available
  '7670cc2d08b0b4a846ac6ec076c99d3767c4d2b9322e2d31cd05871422ddbbda', // image not available
  '78e6132b4b2566fbab177137480d0f883aee9c2370bd9a668787263c1a2d9138', // official logo soon
  'b602abdd01273f6dd29855a6aed585747243148768da4a5a54e3cebd9989fd36', // escudo-contorno cinza
  'a2cea5dc38d2802f6f45317809cba250357b375cd3ba0373754fa9b4938f453b', // escudo-contorno cinza
]);

/** Kinds de core.asset que são logo de time ou de competição (o placeholder vira "sem logo"). */
export const LOGO_KIND_VALUES = ['team_logo', 'league_logo'] as const satisfies readonly MediaAssetKind[];
export const LOGO_KINDS: ReadonlySet<string> = new Set(LOGO_KIND_VALUES);

/**
 * Kinds cujo asset ausente (404, bloqueado ou imagem genérica) deixa a entidade sem imagem: a normalização
 * não religa e a API não cai na URL de origem, que é o próprio placeholder ou um 404. Vale para todos os kinds
 * da CDN de mídia: estádio, circuito, bandeira, lutador e piloto também recebem as imagens genéricas.
 */
export const DETACHED_WHEN_MISSING_KINDS: ReadonlySet<string> = new Set<MediaAssetKind>([
  ...(PERSON_PHOTO_KINDS as ReadonlySet<MediaAssetKind>),
  ...LOGO_KIND_VALUES,
  'venue',
  'circuit',
  'flag',
  'fighter',
  'driver',
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
