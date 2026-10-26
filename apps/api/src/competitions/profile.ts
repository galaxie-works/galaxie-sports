import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { competition, competitionProfile } from '@galaxie/db';
import type { AppContext, ReviewStatus } from '../context.js';

/**
 * Piso editorial do perfil semântico da competição (`semantic.competition_profile`: rótulo, apelidos e
 * apelido do troféu), o mesmo da camada semântica (SEMANTIC_MIN_REVIEW_STATUS, padrão `approved`).
 *
 * O status é o da coluna `review_status`, que o seed grava já com as decisões do painel de revisão (o
 * aprovado no painel vence o YAML enquanto o conteúdo não mudar) e que o painel atualiza na hora. Perfil
 * abaixo do piso não entra na resposta: a competição sai com o rótulo do catálogo (`core.competition`) ou
 * o nome do fornecedor, sem apelidos nem troféu, e a busca não casa pelos apelidos dela.
 */

const REVIEW_ORDER: readonly ReviewStatus[] = ['draft', 'reviewed', 'approved'];

/** Piso do servidor (SEMANTIC_MIN_REVIEW_STATUS); padrão `approved`, como em toda a camada semântica. */
export const semanticFloor = (ctx: Pick<AppContext, 'semantic'>): ReviewStatus =>
  ctx.semantic?.minReviewStatus ?? 'approved';

/** Status servidos num piso (`reviewed` → `reviewed`, `approved`). */
export const servedStatuses = (min: ReviewStatus): ReviewStatus[] =>
  REVIEW_ORDER.slice(Math.max(0, REVIEW_ORDER.indexOf(min)));

/** Condição: o perfil atinge o piso. */
export const competitionProfileServed = (min: ReviewStatus): SQL =>
  inArray(competitionProfile.reviewStatus, servedStatuses(min));

/** Condição do `left join` do perfil com `core.competition`: só o perfil no piso. */
export const competitionProfileJoin = (min: ReviewStatus): SQL =>
  and(eq(competitionProfile.competitionId, competition.id), competitionProfileServed(min))!;

/** A mesma condição em SQL cru, para um alias da tabela (`x.review_status in (...)`). */
export const competitionProfileServedSql = (alias: string, min: ReviewStatus): SQL =>
  sql`${sql.raw(alias)}.review_status in (${sql.join(
    servedStatuses(min).map((s) => sql`${s}`),
    sql`, `,
  )})`;
