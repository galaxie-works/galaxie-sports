/**
 * Países da navegação (home Explorar, índice de países, menu lateral, agenda e `/v1/navigation`): vêm do catálogo de
 * competições no banco, não de uma lista fixa. Um país entra quando tem liga nacional do esporte principal no catálogo
 * ativo (tier 1–2 de `core.competition`, que o bootstrap grava a partir de config/competitions); a liga principal é a
 * de `pickMainCompetition` (menor tier, depois a ordem de `featured` em config/geo, a marcação editorial das divisões).
 * Estaduais e regionais (lista `regional` de config/geo) não contam: um país não entra só com um campeonato estadual.
 */
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { competition, type Database } from '@galaxie/db';
import type { GeoConfig } from '@galaxie/geo';
import { MAIN_SPORT, pickMainCompetition, type CatalogItem } from './choices.js';

/** Catálogo ativo: tier 1 e 2 (o 3 é só espelho, sem marcação de divisão). */
export const CATALOG_MAX_TIER = 2;

/** O que a escolha dos países lê da configuração geográfica. */
export type NavigationGeo = Pick<GeoConfig, 'country' | 'isRegional' | 'featuredOrder'>;

/** Competição do catálogo com o mínimo para escolher a liga principal. */
export type LeagueCandidate = Pick<
  CatalogItem,
  'sport' | 'slug' | 'type' | 'tier' | 'countryCode' | 'recent'
>;

/**
 * Liga principal de cada país com liga nacional do esporte principal no catálogo ativo (país → liga). Só países
 * membros de uma confederação (`WORLD` e as regiões dos outros esportes ficam de fora).
 */
export function mainLeagues<T extends LeagueCandidate>(
  catalog: readonly T[],
  geo: NavigationGeo,
): Map<string, T> {
  const byCountry = new Map<string, T[]>();
  for (const c of catalog) {
    if (c.sport !== MAIN_SPORT || c.type !== 'league' || c.tier > CATALOG_MAX_TIER || !c.countryCode)
      continue;
    if (geo.isRegional(c.sport, c.slug) || !geo.country(c.countryCode)) continue;
    const list = byCountry.get(c.countryCode);
    if (list) list.push(c);
    else byCountry.set(c.countryCode, [c]);
  }
  const out = new Map<string, T>();
  for (const [code, items] of byCountry) {
    const main = pickMainCompetition(items, (s, slug) => geo.featuredOrder(s, slug));
    if (main) out.set(code, main);
  }
  return out;
}

/** Um país da navegação: confederação e a liga principal (para a ordem). */
export interface NavigationCountry {
  code: string;
  confederation: string;
  main: { id: string; slug: string; tier: number };
}

/** Chave de ordem de um país da navegação. */
export interface CountryOrderKey {
  code: string;
  confederation: string;
  /** Tier da liga principal. */
  tier: number;
  /** Posição da liga principal em `featured` (config/geo); null fora da lista. */
  featured: number | null;
  /** Jogos nos próximos 7 dias (só no resumo; sem ele, o desempate vai direto ao nome). */
  upcoming?: number;
  /** Nome no idioma da resposta. */
  name: string;
}

/**
 * Ordem estável dos países: a confederação na ordem de config/geo; dentro dela, o peso que o catálogo já dá à liga
 * principal (tier, depois a posição em `featured`); empatado, mais jogos nos próximos 7 dias, depois o nome e o código.
 */
export function compareCountries(
  confederations: readonly string[],
  locale: string,
): (a: CountryOrderKey, b: CountryOrderKey) => number {
  const collator = new Intl.Collator(locale);
  const conf = (c: string) => {
    const i = confederations.indexOf(c);
    return i < 0 ? confederations.length : i;
  };
  const featured = (n: number | null) => n ?? Number.MAX_SAFE_INTEGER;
  return (a, b) =>
    conf(a.confederation) - conf(b.confederation) ||
    a.tier - b.tier ||
    featured(a.featured) - featured(b.featured) ||
    (b.upcoming ?? 0) - (a.upcoming ?? 0) ||
    collator.compare(a.name, b.name) ||
    a.code.localeCompare(b.code);
}

/**
 * Os países da navegação lidos do banco numa consulta leve: só as ligas do esporte principal no catálogo ativo
 * (algumas dezenas de linhas de `core.competition`, sem tocar em `core.event`). Sem a contagem de jogos recentes, o
 * desempate da liga principal fora de `featured` é o slug; a home usa a do resumo pré-calculado, que tem a contagem.
 * Na ordem de `compareCountries` sem os jogos e com o código no lugar do nome (quem responde reordena pelo nome).
 */
export async function loadNavigationCountries(db: Database, geo: GeoConfig): Promise<NavigationCountry[]> {
  const rows = await db
    .select({
      id: competition.id,
      sport: competition.sport,
      slug: competition.slug,
      type: competition.type,
      tier: competition.tier,
      countryCode: competition.countryCode,
    })
    .from(competition)
    .where(
      and(
        eq(competition.sport, MAIN_SPORT),
        eq(competition.type, 'league'),
        lte(competition.tier, CATALOG_MAX_TIER),
        isNotNull(competition.countryCode),
      ),
    );
  const mains = mainLeagues(
    rows.map((r) => ({ ...r, recent: 0 })),
    geo,
  );
  const confederations = geo.confederations.map((c) => c.code);
  const order = compareCountries(confederations, 'en');
  return [...mains]
    .map(([code, main]) => ({
      code,
      confederation: geo.country(code)!.confederation,
      main: { id: main.id, slug: main.slug, tier: main.tier },
    }))
    .sort((a, b) =>
      order(
        { ...a, tier: a.main.tier, featured: geo.featuredOrder(MAIN_SPORT, a.main.slug), name: a.code },
        { ...b, tier: b.main.tier, featured: geo.featuredOrder(MAIN_SPORT, b.main.slug), name: b.code },
      ),
    );
}
