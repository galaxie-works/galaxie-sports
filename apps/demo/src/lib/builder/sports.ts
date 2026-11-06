/**
 * Esportes no Builder (épico #731): as abas do catálogo seguem as famílias da navegação
 * (`sport-families.ts`: Futebol, Basquete com NBA, Vôlei...), e cada aba mostra os tipos de widget que
 * valem para algum esporte da família (`WIDGET_CATALOG[kind].sports`). Puro: servidor, navegador e testes.
 */
import {
  WIDGET_CATALOG,
  widgetKindIsAllSports,
  widgetKindIsMultiSport,
  widgetKindSupportsSport,
} from '@galaxie/widgets';

import { SPORT_FAMILIES, familyBySlug, familyOf, type SportFamily } from '@/lib/sport-families';

import type { WidgetDefaults, WidgetKind } from './types';

/** Parâmetro da URL com a aba do catálogo (`/cliente/builder?esporte=basquete`), que segue para o "Criar". */
export const CATALOG_TAB_PARAM = 'esporte';

/** Esportes da família que o plano libera (plano sem lista = todos). */
const allowedSports = (family: SportFamily, tenantSports: readonly string[]) =>
  family.sports.filter((s) => !tenantSports.length || tenantSports.includes(s));

/**
 * Abas do catálogo: as famílias com algum esporte do plano e algum tipo de widget pronto para ele (aba
 * vazia não aparece), na ordem do menu, cada uma com os tipos dela.
 */
export function catalogTabs(
  kinds: readonly WidgetKind[],
  tenantSports: readonly string[],
): { family: SportFamily; kinds: WidgetKind[] }[] {
  return SPORT_FAMILIES.flatMap((family) => {
    const sports = allowedSports(family, tenantSports);
    const fit = kinds.filter((k) => sports.some((s) => widgetKindSupportsSport(k, s)));
    return sports.length && fit.length ? [{ family, kinds: fit }] : [];
  });
}

/** Aba pedida na URL (`?esporte=basquete`) entre as que existem; senão a primeira. */
export function pickTab<T extends { family: SportFamily }>(tabs: T[], param: unknown): T | undefined {
  return tabs.find((t) => t.family.id === param) ?? tabs[0];
}

/**
 * Esporte padrão de um tipo de vários esportes sem esporte gravado: nenhum ("Todos os esportes") nos de
 * todos os esportes; o primeiro da lista (o futebol, de onde vieram os widgets antigos) nos outros.
 */
export function defaultSport(kind: WidgetKind): string | null {
  return widgetKindIsAllSports(kind) ? null : (WIDGET_CATALOG[kind].sports[0] ?? null);
}

/**
 * Esporte de um widget novo criado da aba da família: o primeiro esporte dela que o tipo aceita (Basquete
 * → `basketball`, que já traz a NBA). Os tipos de um esporte só não gravam o esporte (é implícito).
 */
export function sportForNewWidget(kind: WidgetKind, familyParam: unknown): string | null {
  if (!widgetKindIsMultiSport(kind)) return null;
  const family = typeof familyParam === 'string' ? familyBySlug(familyParam) : undefined;
  return family?.sports.find((s) => widgetKindSupportsSport(kind, s)) ?? defaultSport(kind);
}

/**
 * Esporte que fica ao trocar o tipo no editor: o atual, se o tipo novo aceita; senão o da mesma família
 * que ele aceita, ou o padrão do tipo. Tipo de um esporte só: nenhum.
 */
export function sportOnKindChange(kind: WidgetKind, current: string | null): string | null {
  if (!widgetKindIsMultiSport(kind)) return null;
  if (current === null) return defaultSport(kind);
  if (widgetKindSupportsSport(kind, current)) return current;
  const family = familyOf(current);
  return family?.sports.find((s) => widgetKindSupportsSport(kind, s)) ?? defaultSport(kind);
}

/**
 * Família de um widget salvo, para a coluna Esporte: a do esporte gravado; nos tipos de um esporte só, a
 * desse esporte; null = todos os esportes.
 */
export function widgetFamily(
  kind: WidgetKind,
  defaults: WidgetDefaults | null | undefined,
): SportFamily | null {
  const sport = defaults?.sport ?? defaultSport(kind) ?? undefined;
  return sport ? (familyOf(sport) ?? null) : null;
}

/**
 * Esportes que o seletor do editor oferece, na ordem do menu, só os do plano e, com `kind`, os que o tipo
 * aceita. Cada esporte da API entra separado (Basquete e NBA vêm de APIs diferentes e a API filtra pelo
 * esporte exato).
 */
export function sportChoices(
  tenantSports: readonly string[],
  kind?: WidgetKind,
): { family: SportFamily; sport: string }[] {
  return SPORT_FAMILIES.flatMap((family) =>
    allowedSports(family, tenantSports)
      .filter((sport) => !kind || widgetKindSupportsSport(kind, sport))
      .map((sport) => ({ family, sport })),
  );
}

/** Esporte da busca de entidade e da prévia: o escolhido nos tipos de vários esportes, o único nos outros. */
export function searchSport(kind: WidgetKind, chosen: string | null): string | null {
  return widgetKindIsMultiSport(kind) ? chosen : (WIDGET_CATALOG[kind].sports[0] ?? null);
}
