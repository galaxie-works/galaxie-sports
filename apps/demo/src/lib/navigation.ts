import type { MirrorSport } from '@galaxie/contracts';
import {
  Activity,
  Award,
  CarFront,
  CircleDot,
  Goal,
  Hand,
  HandFist,
  Medal,
  Shield,
  Trophy,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';

import { HockeyStick } from '../components/icons/hockey-stick';

import type { Dictionary } from './i18n/dictionary';
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

/** Os 12 esportes do espelho; a ordem prioriza o que tem cobertura hoje. Ícones provisórios até o Figma. */
export const SPORTS: SportNav[] = (
  [
    ['football', Goal],
    ['basketball', CircleDot],
    ['nba', CircleDot],
    ['volleyball', Volleyball],
    ['formula-1', CarFront],
    ['mma', HandFist],
    ['american-football', Shield],
    ['baseball', Activity],
    ['hockey', HockeyStick],
    ['handball', Hand],
    ['rugby', Trophy],
    ['afl', Trophy],
  ] as const
).map(([slug, icon]) => ({ slug, icon, href: `/esportes/${slug}` }));

export const MULTISPORT_NAV: NavItem = { href: '/multiesporte', icon: Medal };

/** Hipismo: esporte próprio (fora do espelho da api-sports), com ícone animado `equestrian` (docs/13). */
export const EQUESTRIAN_NAV: NavItem & { slug: string } = {
  href: '/hipismo',
  icon: Award,
  slug: 'equestrian',
};

export type CountryCode = keyof Dictionary['nav']['countries'];

export interface CountryNav {
  code: CountryCode;
  group: 'CONMEBOL' | 'CONCACAF' | 'UEFA';
  href: string;
}

/** Países com navegação própria (decisão de UI/UX); a lista definitiva virá de `/v1/navigation`. */
export const COUNTRIES: CountryNav[] = (
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
).map(([code, group]) => ({ code, group, href: `/paises/${code.toLowerCase()}` }));

export const sportBySlug = (slug: string) => SPORTS.find((s) => s.slug === slug);
export const countryByCode = (code: string) =>
  COUNTRIES.find((c) => c.code.toLowerCase() === code.toLowerCase());

/**
 * Página de país para um código da API, ou null quando o código não é de país (a API devolve "World"
 * para campeonatos mundiais e responde 400 a `/paises/world`): aí o nome aparece sem link.
 */
export function countryHref(code: string | null | undefined): string | null {
  return code && /^[A-Za-z]{2}(-[A-Za-z]{3})?$/.test(code) ? `/paises/${code.toLowerCase()}` : null;
}

/** Pai de topo de uma página de esporte (competição, time, jogo): o item do menu daquele esporte. */
export function sportParent(slug: string, t: Dictionary): TrailVisit | null {
  const sport = sportBySlug(slug);
  return sport ? { path: sport.href, label: t.nav.sports[sport.slug], kind: 'esporte' } : null;
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
  const query = new URLSearchParams({ aba: 'jogos', data: event.starts_at.slice(0, 10) });
  if (event.stage?.name) query.set('rodada', event.stage.name);
  return `/competicoes/${event.competition.slug}?${query}`;
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
  const season = new URLSearchParams({ data: event.starts_at.slice(0, 10) });
  parents.push({
    path: `/competicoes/${event.competition.slug}?${season}`,
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

/** Piloto e lutador têm rota própria (`/pilotos`, `/lutadores`); os demais participantes ficam em /times. */
const INDIVIDUAL_ROUTES: Partial<Record<string, string>> = { driver: '/pilotos', fighter: '/lutadores' };

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
 * Página de um participante: `/pilotos/max-verstappen-<id>` e `/lutadores/<nome>-<id>` (o id no fim
 * resolve sem depender de slug no banco), `/times/<id>` para os demais. Sem `kind`, /times, que
 * redireciona piloto e lutador para a rota certa.
 */
export function participantHref(p: { id: string; name: string }, kind?: string | null): string {
  const route = kind ? INDIVIDUAL_ROUTES[kind] : undefined;
  if (!route) return `/times/${p.id}`;
  const slug = slugify(p.name);
  return `${route}/${slug ? `${slug}-` : ''}${p.id}`;
}

/** Piloto ou lutador (rota própria)? */
export const isIndividualKind = (kind: string | null | undefined) => !!kind && !!INDIVIDUAL_ROUTES[kind];

/** Id do participante no fim do slug (`max-verstappen-<uuid>` ou só `<uuid>`); null se não houver. */
export function idFromSlug(slug: string): string | null {
  return UUID_AT_END.exec(decodeURIComponent(slug))?.[1]?.toLowerCase() ?? null;
}
