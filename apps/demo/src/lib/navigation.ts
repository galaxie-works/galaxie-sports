import type { MirrorSport } from '@galaxie/contracts';
import {
  Activity,
  Award,
  CarFront,
  CircleDot,
  Dumbbell,
  Goal,
  Hand,
  HandFist,
  Medal,
  Shield,
  Trophy,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';

import type { Dictionary } from './i18n/dictionary';

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
    ['hockey', Dumbbell],
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
