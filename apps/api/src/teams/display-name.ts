import { eq, inArray } from 'drizzle-orm';
import { participant, teamProfile, type Database } from '@galaxie/db';
import type { AppContext, ReviewStatus } from '../context.js';
import { pickText } from '../i18n.js';
import { accentTeamName } from './accents.js';

/**
 * Nome de exibição dos times em toda a API (evento, listas, classificação, busca, perfil).
 *
 * 1. Time com perfil na base semântica no piso editorial (SEMANTIC_MIN_REVIEW_STATUS): o rótulo do idioma
 *    pedido (`labels`, pt-BR → pt → en; es-AR → es → en) ou, sem rótulo, o nome curto curado
 *    (`names.short`) — o mesmo nome de `/v1/teams/{id}/semantic` e dos gritos da torcida.
 * 2. Sem perfil (ou abaixo do piso): o nome do fornecedor, com o corretor de acentos (`accentTeamName`)
 *    quando o país do time é de língua portuguesa ou espanhola.
 *
 * O nome original do fornecedor segue em `provider_name`.
 */

const REVIEW_ORDER: readonly ReviewStatus[] = ['draft', 'reviewed', 'approved'];
const reviewRank = (s: string | null | undefined) => REVIEW_ORDER.indexOf(s as ReviewStatus);

/** Tipos de participante que são times (o corretor não mexe em pilotos, lutadores e atletas). */
const TEAM_KINDS = new Set(['club', 'national_team']);

/** Idioma pedido e piso editorial da base semântica. */
export interface TeamNameOptions {
  locale: string;
  minReview: ReviewStatus;
}

/** Opções da requisição: o piso é o do servidor (padrão `approved`, como em toda a camada semântica). */
export function teamNameOptions(ctx: Pick<AppContext, 'semantic'>, locale: string): TeamNameOptions {
  return { locale, minReview: ctx.semantic?.minReviewStatus ?? 'approved' };
}

/** Campos do perfil semântico usados no nome. */
export interface TeamNameProfile {
  labels: unknown;
  names: unknown;
  reviewStatus: string;
}

export interface TeamNameSource {
  /** Nome do fornecedor (`core.participant.name`). */
  name: string;
  countryCode: string | null;
  kind?: string | null;
  profile?: TeamNameProfile | null;
}

/** Nome curado do perfil no idioma: rótulo (labels) ou nome curto; null sem nenhum dos dois. */
export function curatedTeamName(
  profile: Pick<TeamNameProfile, 'labels' | 'names'>,
  locale: string,
): string | null {
  const short = (profile.names as { short?: unknown } | null)?.short;
  const fallback = typeof short === 'string' && short.trim() ? short : undefined;
  const labels = profile.labels as Record<string, string> | null;
  return pickText(labels, locale, fallback) ?? null;
}

/** Nome de exibição de um time (regra no topo do arquivo). */
export function teamDisplayName(src: TeamNameSource, options: TeamNameOptions): string {
  const profile = src.profile;
  if (profile && reviewRank(profile.reviewStatus) >= reviewRank(options.minReview)) {
    const curated = curatedTeamName(profile, options.locale);
    if (curated) return curated;
  }
  if (src.kind && !TEAM_KINDS.has(src.kind)) return src.name;
  return accentTeamName(src.name, src.countryCode);
}

/** Nome exibido e o original do fornecedor, prontos para a resposta. */
export interface TeamNames {
  name: string;
  provider_name: string;
}

interface LoadedTeam {
  kind: string;
  countryCode: string | null;
  profile: TeamNameProfile | null;
}

/** Nomes de um lote de participantes, carregados numa consulta (`loadTeamNames`). */
export class TeamNamer {
  constructor(
    private readonly teams: ReadonlyMap<string, LoadedTeam>,
    readonly options: TeamNameOptions,
  ) {}

  /** Nome exibido do participante `id`; fora do lote carregado, o nome do fornecedor como veio. */
  of(id: string | null | undefined, providerName: string): TeamNames {
    const t = id ? this.teams.get(id) : undefined;
    const name = t
      ? teamDisplayName(
          { name: providerName, countryCode: t.countryCode, kind: t.kind, profile: t.profile },
          this.options,
        )
      : providerName;
    return { name, provider_name: providerName };
  }

  /** Só o nome exibido (textos e campos sem `provider_name`). */
  name(id: string | null | undefined, providerName: string): string {
    return this.of(id, providerName).name;
  }
}

/**
 * Carrega país, tipo e perfil semântico dos participantes para montar os nomes. Um participante com mais de
 * um perfil usa o mais revisado (desempate pelo slug, estável).
 */
export async function loadTeamNames(
  db: Database,
  ids: Iterable<string | null | undefined>,
  options: TeamNameOptions,
): Promise<TeamNamer> {
  const list = [...new Set([...ids].filter((x): x is string => !!x))];
  const teams = new Map<string, LoadedTeam>();
  if (!list.length) return new TeamNamer(teams, options);
  const rows = await db
    .select({
      id: participant.id,
      kind: participant.kind,
      countryCode: participant.countryCode,
      slug: teamProfile.slug,
      labels: teamProfile.labels,
      names: teamProfile.names,
      reviewStatus: teamProfile.reviewStatus,
    })
    .from(participant)
    .leftJoin(teamProfile, eq(teamProfile.participantId, participant.id))
    .where(inArray(participant.id, list));
  const slugOf = new Map<string, string>();
  for (const r of rows) {
    const profile =
      r.slug && r.names
        ? { labels: r.labels, names: r.names, reviewStatus: r.reviewStatus ?? 'draft' }
        : null;
    const prev = teams.get(r.id);
    const better =
      !prev ||
      (profile &&
        (!prev.profile ||
          reviewRank(profile.reviewStatus) > reviewRank(prev.profile.reviewStatus) ||
          (reviewRank(profile.reviewStatus) === reviewRank(prev.profile.reviewStatus) &&
            r.slug! < (slugOf.get(r.id) ?? ''))));
    if (!better) continue;
    teams.set(r.id, { kind: r.kind, countryCode: r.countryCode, profile });
    if (r.slug) slugOf.set(r.id, r.slug);
  }
  return new TeamNamer(teams, options);
}
