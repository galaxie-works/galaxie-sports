/**
 * Esportes no Builder (épico #731): as abas do catálogo seguem as famílias da navegação
 * (`sport-families.ts`: Futebol, Basquete com NBA, Vôlei...), e cada aba mostra os tipos de widget que
 * valem para algum esporte da família (`WIDGET_CATALOG[kind].sports`). Puro: servidor, navegador e testes.
 */
import { WIDGET_CATALOG, widgetKindSupportsSport } from '@galaxie/widgets';

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
 * Esporte de um widget novo criado da aba da família: o primeiro esporte dela (Basquete → `basketball`,
 * que já traz a NBA). Só os tipos de todos os esportes gravam o esporte; os de um esporte só tiram da
 * entidade.
 */
export function sportForNewWidget(kind: WidgetKind, familyParam: unknown): string | null {
  if (WIDGET_CATALOG[kind].sports.length) return null;
  const family = typeof familyParam === 'string' ? familyBySlug(familyParam) : undefined;
  return family ? family.sports[0] : null;
}

/**
 * Família de um widget salvo, para a coluna Esporte: a do esporte gravado; nos tipos de um esporte só, a
 * desse esporte; null = todos os esportes.
 */
export function widgetFamily(
  kind: WidgetKind,
  defaults: WidgetDefaults | null | undefined,
): SportFamily | null {
  const sports = WIDGET_CATALOG[kind].sports;
  const sport = defaults?.sport ?? (sports.length === 1 ? sports[0] : undefined);
  return sport ? (familyOf(sport) ?? null) : null;
}

/** Esportes que o seletor do editor oferece: um por família (o primeiro), só os do plano. */
export function sportChoices(tenantSports: readonly string[]): { family: SportFamily; sport: string }[] {
  return SPORT_FAMILIES.flatMap((family) => {
    const sport = allowedSports(family, tenantSports)[0];
    return sport ? [{ family, sport }] : [];
  });
}
