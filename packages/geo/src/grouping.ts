import { COMPETITION_SCOPES, type CompetitionScope } from './schema.js';

/** Dados mínimos de uma competição para agrupar na página do país. */
export interface GroupableCompetition {
  sport: string;
  scope: CompetitionScope;
  /** 1 = cobertura máxima … 3 = apenas espelho. */
  tier: number;
  /**
   * Posição editorial dentro do grupo: ordem do arquivo de escopo (internacionais) ou da lista `featured`
   * (domésticas); null = sem posição (vai depois, por nome).
   */
  order: number | null;
  /** Nome já localizado (desempate). */
  name: string;
}

export interface ScopeGroup<T> {
  scope: CompetitionScope;
  competitions: T[];
}

export interface SportGroups<T> {
  sport: string;
  groups: ScopeGroup<T>[];
}

/**
 * Ordem dentro do grupo. Nas domésticas (nacionais e regionais), a posição editorial vem antes do tier:
 * as divisões em ordem (Série A, B, C, D) e depois as copas nacionais, mesmo a Série B sendo tier 2 e a
 * Copa do Brasil tier 1. Nas internacionais, tier, posição no arquivo de escopo e nome.
 */
export function compareCompetitions(
  a: GroupableCompetition,
  b: GroupableCompetition,
  locale = 'pt-BR',
): number {
  const byOrder = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
  const byName = a.name.localeCompare(b.name, locale);
  if (a.scope === 'domestic' || a.scope === 'regional') return byOrder || a.tier - b.tier || byName;
  return a.tier - b.tier || byOrder || byName;
}

/**
 * Agrupa as competições de um país por esporte (na ordem `sportOrder`; esportes fora dela vão ao fim, em
 * ordem alfabética) e, dentro do esporte, por escopo (doméstico, continental de clubes, seleções,
 * mundial de clubes). Grupos vazios e esportes sem competição são omitidos.
 */
export function groupCompetitions<T extends GroupableCompetition>(
  items: T[],
  sportOrder: string[],
  locale = 'pt-BR',
): SportGroups<T>[] {
  const bySport = new Map<string, T[]>();
  for (const item of items) {
    const list = bySport.get(item.sport) ?? [];
    list.push(item);
    bySport.set(item.sport, list);
  }
  const rank = (s: string) => {
    const i = sportOrder.indexOf(s);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const sports = [...bySport.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return sports.map((sport) => {
    const list = bySport.get(sport)!;
    const groups = COMPETITION_SCOPES.map((scope) => ({
      scope,
      competitions: list.filter((c) => c.scope === scope).sort((a, b) => compareCompetitions(a, b, locale)),
    })).filter((g) => g.competitions.length > 0);
    return { sport, groups };
  });
}
