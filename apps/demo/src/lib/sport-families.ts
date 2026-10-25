/**
 * Famílias de esporte da demo: o menu e as páginas de esporte agrupam pelo que a pessoa reconhece
 * (Basquete, Automobilismo, Lutas), não pela API do fornecedor. Na API, `nba` e `basketball` (e
 * `formula-1`) seguem esportes separados, porque vêm de APIs diferentes; só a apresentação junta.
 *
 * Este é o único lugar do mapa família → esportes. Os rótulos ficam nos dicionários
 * (`t.nav.families[id]`), nos três idiomas. O `id` é também o slug da rota (`/esportes/basquete`).
 *
 * Módulo puro: serve ao proxy (redirecionamento das rotas antigas), ao servidor, ao navegador e aos testes.
 */
import type { CompetitionSummary, MirrorSport } from '@galaxie/contracts';

export interface SportFamilyDef {
  /** Slug da rota e chave do rótulo no dicionário. */
  id: string;
  /** Esportes da API que a família reúne; o primeiro dá o ícone. */
  sports: readonly MirrorSport[];
  /**
   * Esportes com seção própria na página da família, antes dos grupos por país (a NBA dentro de
   * Basquete). Nas competições repetidas entre as APIs, vale a versão deste esporte.
   */
  sections?: readonly MirrorSport[];
}

/** Ordem do menu: a mesma dos esportes (o que tem mais cobertura primeiro). */
export const SPORT_FAMILIES = [
  { id: 'futebol', sports: ['football'] },
  { id: 'basquete', sports: ['basketball', 'nba'], sections: ['nba'] },
  { id: 'volei', sports: ['volleyball'] },
  // Fórmula 1 hoje; outras categorias (Fórmula E, Indy, Stock Car) entram nesta mesma família
  { id: 'automobilismo', sports: ['formula-1'] },
  { id: 'lutas', sports: ['mma'] },
  { id: 'futebol-americano', sports: ['american-football'] },
  { id: 'beisebol', sports: ['baseball'] },
  { id: 'hoquei', sports: ['hockey'] },
  { id: 'handebol', sports: ['handball'] },
  { id: 'rugbi', sports: ['rugby'] },
  { id: 'futebol-australiano', sports: ['afl'] },
] as const satisfies readonly SportFamilyDef[];

export type SportFamily = (typeof SPORT_FAMILIES)[number];
export type FamilyId = SportFamily['id'];

const sectionsOf = (family: SportFamily): readonly string[] => ('sections' in family ? family.sections : []);

export const familyHref = (family: Pick<SportFamily, 'id'>) => `/esportes/${family.id}`;

export const familyBySlug = (slug: string): SportFamily | undefined =>
  SPORT_FAMILIES.find((f) => f.id === slug);

/** Família de um esporte da API (`nba` → Basquete); undefined para esporte fora do menu. */
export const familyOf = (sport: string): SportFamily | undefined =>
  SPORT_FAMILIES.find((f) => (f.sports as readonly string[]).includes(sport));

/**
 * Página de um esporte da API dentro da família: a da família e, para esporte com seção própria, a
 * âncora dela (`/esportes/basquete#nba`).
 */
export function sportHref(sport: string): string | null {
  const family = familyOf(sport);
  if (!family) return null;
  return sectionsOf(family).includes(sport) ? `${familyHref(family)}#${sport}` : familyHref(family);
}

/**
 * Rota antiga, por esporte da API (`/esportes/nba`, `/esportes/formula-1`), para a da família. Links
 * guardados, favoritos e a trilha de outra aba continuam funcionando. Null quando não é rota antiga.
 */
export function legacySportRedirect(pathname: string): string | null {
  const match = /^\/esportes\/([^/]+)\/?$/.exec(pathname);
  if (!match || familyBySlug(match[1]!)) return null;
  return sportHref(match[1]!);
}

/** Competição como a página da família a recebe de cada esporte. */
export interface FamilyCompetition {
  slug: string;
  name: string;
  logo: string | null;
}

/** Chave para achar a mesma competição nas duas APIs: as palavras do nome, sem ordem nem pontuação. */
function sameCompetitionKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Junta as competições dos esportes da família. A mesma competição vinda de duas APIs (a NBA no
 * basquete e na API da NBA: "NBA - Las Vegas Summer League" × "NBA Summer League Las Vegas", com o
 * mesmo logo) aparece uma vez só, na versão do esporte com seção própria. A comparação é só com o que
 * já entrou de outro esporte: dentro da mesma lista, ligas homônimas de países diferentes (ou com o
 * mesmo logo genérico) são competições distintas e ficam todas.
 */
export function mergeFamilyCompetitions<T extends FamilyCompetition>(
  family: SportFamily,
  lists: { sport: string; items: T[] }[],
): { sport: string; items: T[] }[] {
  const preferred = sectionsOf(family);
  const ordered = [...lists].sort(
    (a, b) => Number(preferred.includes(b.sport)) - Number(preferred.includes(a.sport)),
  );
  // nomes e logos dos esportes já processados; os da lista atual só entram no fim dela
  const seenNames = new Set<string>();
  const seenLogos = new Set<string>();
  const kept = new Map<string, T[]>();
  for (const { sport, items } of ordered) {
    const out = items.filter(
      (c) => !seenNames.has(sameCompetitionKey(c.name)) && !(c.logo && seenLogos.has(c.logo)),
    );
    for (const c of out) {
      seenNames.add(sameCompetitionKey(c.name));
      if (c.logo) seenLogos.add(c.logo);
    }
    kept.set(sport, out);
  }
  return lists.map(({ sport }) => ({ sport, items: kept.get(sport) ?? [] }));
}

/**
 * Ordem das competições num grupo da página da família: as nacionais (Série A a D, Copa do Brasil) antes
 * dos estaduais e regionais (`level`), mesmo quando um estadual está entre os destaques da API
 * (`featured`, a posição em `top_competitions`); dentro do nível, os destaques na frente, depois a ordem
 * editorial da API, o tier e o nome.
 */
export function sortFamilyCompetitions<
  T extends Pick<CompetitionSummary, 'slug' | 'level' | 'order' | 'tier' | 'name'>,
>(items: T[], featured: Map<string, number>, locale: string): T[] {
  return [...items].sort(
    (a, b) =>
      Number(a.level === 'regional') - Number(b.level === 'regional') ||
      (featured.get(a.slug) ?? Infinity) - (featured.get(b.slug) ?? Infinity) ||
      (a.order ?? Infinity) - (b.order ?? Infinity) ||
      a.tier - b.tier ||
      a.name.localeCompare(b.name, locale),
  );
}

/** Esportes da família com seção própria (na ordem da família). */
export const familySections = (family: SportFamily): string[] =>
  family.sports.filter((s) => sectionsOf(family).includes(s));
