import type { MirrorSport } from '@galaxie/contracts';
import {
  Award,
  CarFront,
  Hand,
  HandFist,
  Medal,
  // o "rugby-ball" do lucide tem cadarço: é a bola do futebol americano
  RugbyBall as AmericanFootballBall,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';

import { Baseball } from '../components/icons/baseball';
import { Basketball } from '../components/icons/basketball';
import { HockeyStick } from '../components/icons/hockey-stick';
import { RugbyBall } from '../components/icons/rugby-ball';
import { SoccerBall } from '../components/icons/soccer-ball';

import type { Dictionary } from './i18n/dictionary';
import { SPORT_FAMILIES, familyHref, familyOf, sportHref, type FamilyId } from './sport-families';
import type { TrailVisit } from './trail';

/** Rótulos ficam nos dicionários (`t.nav.sports[slug]`, `t.nav.countries[code]`, `t.nav.multisport`). */
export interface NavItem {
  href: string;
  icon: LucideIcon;
}

type SportSlug = keyof Dictionary['nav']['sports'] & MirrorSport;

export interface SportNav extends NavItem {
  slug: SportSlug;
}

/**
 * Os 12 esportes do espelho (um por API do fornecedor); a ordem prioriza o que tem cobertura hoje. Mapa
 * único de esporte → ícone do app (menu, filtros do Ao vivo, explorar, agenda, busca): a bola ou o objeto
 * de cada esporte, no traço do lucide; os que o lucide não tem ficam em components/icons. NBA usa o do
 * basquete e AFL o do rúgbi (bola oval, como a animação). O link leva à página da família
 * (`nba` → `/sports/basketball#nba`).
 */
export const SPORTS: SportNav[] = (
  [
    ['football', SoccerBall],
    ['basketball', Basketball],
    ['nba', Basketball],
    ['volleyball', Volleyball],
    ['formula-1', CarFront],
    ['mma', HandFist],
    ['american-football', AmericanFootballBall],
    ['baseball', Baseball],
    ['hockey', HockeyStick],
    ['handball', Hand],
    ['rugby', RugbyBall],
    ['afl', RugbyBall],
  ] as const
).map(([slug, icon]) => ({ slug, icon, href: sportHref(slug)! }));

export interface FamilyNav extends NavItem {
  id: FamilyId;
  /** Esporte que dá o ícone animado (o primeiro da família). */
  slug: SportSlug;
}

/** Itens de esporte do menu: uma família por item (Basquete reúne basquete e NBA). Mapa em sport-families.ts. */
export const FAMILIES: FamilyNav[] = SPORT_FAMILIES.map((f) => {
  const slug = f.sports[0];
  return { id: f.id, slug, icon: SPORTS.find((s) => s.slug === slug)!.icon, href: familyHref(f) };
});

export const MULTISPORT_NAV: NavItem = { href: '/multisport', icon: Medal };

/** Hipismo: esporte próprio (fora do espelho da api-sports), com ícone animado `equestrian` (docs/13). */
export const EQUESTRIAN_NAV: NavItem & { slug: string } = {
  href: '/equestrian',
  icon: Award,
  slug: 'equestrian',
};

/** Países com nome no dicionário da demo (os da lista de reserva). */
export type CountryCode = keyof Dictionary['nav']['countries'];

export interface CountryNav {
  /** Código da api-sports (ISO2 ou extensão, como GB-ENG). */
  code: string;
  /** Confederação (CONMEBOL, CONCACAF, UEFA, AFC, CAF, OFC). */
  group: string;
  href: string;
}

export const countryNav = (code: string, group: string): CountryNav => ({
  code,
  group,
  href: `/countries/${code.toLowerCase()}`,
});

/** Ordem das confederações na reserva (a da API segue config/geo, a mesma). */
export const FALLBACK_CONFEDERATIONS = ['CONMEBOL', 'CONCACAF', 'UEFA'] as const;

/**
 * Reserva para quando a API não responde: os países da navegação vêm do banco (`/v1/explore/summary` e
 * `/v1/navigation`, os que têm liga nacional de primeira divisão no catálogo). Esta lista só aparece com a API fora
 * do ar (e no exemplo público, sem sessão); nunca é a fonte principal.
 */
export const FALLBACK_COUNTRIES: CountryNav[] = (
  [
    ['BR', 'CONMEBOL'],
    ['AR', 'CONMEBOL'],
    ['UY', 'CONMEBOL'],
    ['CL', 'CONMEBOL'],
    ['CO', 'CONMEBOL'],
    ['PY', 'CONMEBOL'],
    ['PE', 'CONMEBOL'],
    ['EC', 'CONMEBOL'],
    ['BO', 'CONMEBOL'],
    ['VE', 'CONMEBOL'],
    ['MX', 'CONCACAF'],
    ['GB-ENG', 'UEFA'],
    ['ES', 'UEFA'],
    ['IT', 'UEFA'],
    ['DE', 'UEFA'],
    ['FR', 'UEFA'],
    ['PT', 'UEFA'],
  ] as const
).map(([code, group]) => countryNav(code, group));

/** Uma confederação com os seus países, na ordem da resposta. */
export interface CountryGroup {
  code: string;
  countries: CountryNav[];
}

/**
 * Países por confederação a partir da resposta da API (`confederations` do resumo do Explorar ou de
 * `/v1/navigation`), na ordem dela; sem resposta (API fora do ar), a lista de reserva.
 */
export function countryGroups(
  source: { confederations: { code: string; countries: string[] }[] } | null | undefined,
): CountryGroup[] {
  if (source)
    return source.confederations
      .filter((c) => c.countries.length > 0)
      .map((c) => ({ code: c.code, countries: c.countries.map((code) => countryNav(code, c.code)) }));
  return FALLBACK_CONFEDERATIONS.map((code) => ({
    code,
    countries: FALLBACK_COUNTRIES.filter((c) => c.group === code),
  }));
}

/**
 * Nome do país no idioma da tela: o do dicionário (os países de sempre, iguais em toda a demo), senão o que a API
 * devolveu no idioma pedido, senão o nome da região pelo navegador (`Intl.DisplayNames`), senão o código.
 */
export function countryName(
  t: { nav: Pick<Dictionary['nav'], 'countries'> },
  locale: string,
  code: string,
  apiName?: string | null,
): string {
  const known = (t.nav.countries as Record<string, string | undefined>)[code];
  if (known) return known;
  if (apiName) return apiName;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    // extensões da api-sports (GB-SCT) não são regiões ISO
    return code;
  }
}

/** Subtítulo da confederação ("América do Sul"); o código sozinho quando o dicionário não tem. */
export function confederationLabel(
  t: { nav: Pick<Dictionary['nav'], 'groups'> },
  code: string,
): string | null {
  return (t.nav.groups as Record<string, string | undefined>)[code] ?? null;
}

export const sportBySlug = (slug: string) => SPORTS.find((s) => s.slug === slug);

/**
 * Página de país para um código da API, ou null quando o código não é de país (a API devolve "World"
 * para campeonatos mundiais e responde 400 a `/countries/world`): aí o nome aparece sem link.
 */
export function countryHref(code: string | null | undefined): string | null {
  return code && /^[A-Za-z]{2}(-[A-Za-z]{3})?$/.test(code) ? `/countries/${code.toLowerCase()}` : null;
}

/**
 * Pai de topo de uma página de esporte (competição, time, jogo): o item do menu da família daquele
 * esporte (um jogo da NBA tem "Basquete" na trilha).
 */
export function sportParent(slug: string, t: Dictionary): TrailVisit | null {
  const family = familyOf(slug);
  return family ? { path: familyHref(family), label: t.nav.families[family.id], kind: 'esporte' } : null;
}

/**
 * Link da competição a partir de um jogo: abre na aba de jogos, na rodada e na temporada do jogo (a
 * data do jogo escolhe a temporada), para "voltar à competição" cair onde o jogo está.
 */
export function eventCompetitionHref(event: {
  competition: { slug: string } | null;
  stage: { name: string | null } | null;
  starts_at: string;
}): string | null {
  if (!event.competition) return null;
  const query = new URLSearchParams({ tab: 'matches', date: event.starts_at.slice(0, 10) });
  if (event.stage?.name) query.set('round', event.stage.name);
  return `/competitions/${event.competition.slug}?${query}`;
}

/**
 * Hierarquia de um jogo: esporte › competição (na temporada do jogo) › rodada (os jogos dela) ›
 * jogo. A rodada só entra quando o jogo tem fase.
 */
export function eventParents(
  event: {
    sport: string;
    competition: { slug: string; name: string } | null;
    stage: { name: string | null } | null;
    starts_at: string;
  },
  t: Dictionary,
): TrailVisit[] {
  const parents: TrailVisit[] = [];
  const sport = sportParent(event.sport, t);
  if (sport) parents.push(sport);
  if (!event.competition) return parents;
  const season = new URLSearchParams({ date: event.starts_at.slice(0, 10) });
  parents.push({
    path: `/competitions/${event.competition.slug}?${season}`,
    label: event.competition.name,
    kind: 'competição',
  });
  if (event.stage?.name)
    parents.push({ path: eventCompetitionHref(event)!, label: event.stage.name, kind: 'competição' });
  return parents;
}

/** Pai das páginas internas do hipismo (atleta, cavalo, prova, campeonato). */
export function equestrianParent(t: Dictionary): TrailVisit {
  return { path: EQUESTRIAN_NAV.href, label: t.equestrian.title, kind: 'esporte' };
}

/** Piloto e lutador têm rota própria (`/drivers`, `/fighters`); os demais participantes ficam em /teams. */
const INDIVIDUAL_ROUTES: Partial<Record<string, string>> = { driver: '/drivers', fighter: '/fighters' };

const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Nome em slug de URL ("Max Verstappen" → "max-verstappen"), sem acento. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Página de um participante: `/drivers/max-verstappen-<id>` e `/fighters/<nome>-<id>` (o id no fim
 * resolve sem depender de slug no banco), `/teams/<id>` para os demais. Sem `kind`, /teams, que
 * redireciona piloto e lutador para a rota certa.
 */
export function participantHref(p: { id: string; name: string }, kind?: string | null): string {
  const route = kind ? INDIVIDUAL_ROUTES[kind] : undefined;
  if (!route) return `/teams/${p.id}`;
  const slug = slugify(p.name);
  return `${route}/${slug ? `${slug}-` : ''}${p.id}`;
}

/** Piloto ou lutador (rota própria)? */
export const isIndividualKind = (kind: string | null | undefined) => !!kind && !!INDIVIDUAL_ROUTES[kind];

/** Id do participante no fim do slug (`max-verstappen-<uuid>` ou só `<uuid>`); null se não houver. */
export function idFromSlug(slug: string): string | null {
  return UUID_AT_END.exec(decodeURIComponent(slug))?.[1]?.toLowerCase() ?? null;
}
