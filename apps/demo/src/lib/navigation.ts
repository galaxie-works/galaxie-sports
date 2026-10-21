import type { MirrorSport } from '@galaxie/contracts';
import {
  Activity,
  CalendarDays,
  CarFront,
  CircleDot,
  Dumbbell,
  Goal,
  Hand,
  HandFist,
  LayoutDashboard,
  Medal,
  Radio,
  Shield,
  Trophy,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'Meu dia', icon: CalendarDays },
  { href: '/ao-vivo', label: 'Ao vivo', icon: Radio },
  { href: '/painel', label: 'Painel de operação', icon: LayoutDashboard },
];

export interface SportNav extends NavItem {
  slug: MirrorSport;
}

/** Os 12 esportes do espelho; a ordem prioriza o que tem cobertura hoje. Ícones provisórios até o Figma. */
export const SPORTS: SportNav[] = [
  { slug: 'football', label: 'Futebol', icon: Goal },
  { slug: 'basketball', label: 'Basquete', icon: CircleDot },
  { slug: 'nba', label: 'NBA', icon: CircleDot },
  { slug: 'volleyball', label: 'Vôlei', icon: Volleyball },
  { slug: 'formula-1', label: 'Fórmula 1', icon: CarFront },
  { slug: 'mma', label: 'MMA', icon: HandFist },
  { slug: 'american-football', label: 'Futebol americano', icon: Shield },
  { slug: 'baseball', label: 'Beisebol', icon: Activity },
  { slug: 'hockey', label: 'Hóquei', icon: Dumbbell },
  { slug: 'handball', label: 'Handebol', icon: Hand },
  { slug: 'rugby', label: 'Rúgbi', icon: Trophy },
  { slug: 'afl', label: 'Futebol australiano', icon: Trophy },
].map((s) => ({ ...s, href: `/esportes/${s.slug}` })) as SportNav[];

export const MULTISPORT_NAV: NavItem = { href: '/multiesporte', label: 'Olimpíadas e Pan', icon: Medal };

export interface CountryNav {
  code: string;
  label: string;
  group: 'CONMEBOL' | 'CONCACAF' | 'UEFA';
  href: string;
}

/** Países com navegação própria (decisão de UI/UX); a lista definitiva virá de `/v1/navigation`. */
export const COUNTRIES: CountryNav[] = (
  [
    ['BR', 'Brasil', 'CONMEBOL'],
    ['AR', 'Argentina', 'CONMEBOL'],
    ['UY', 'Uruguai', 'CONMEBOL'],
    ['CL', 'Chile', 'CONMEBOL'],
    ['CO', 'Colômbia', 'CONMEBOL'],
    ['PY', 'Paraguai', 'CONMEBOL'],
    ['PE', 'Peru', 'CONMEBOL'],
    ['EC', 'Equador', 'CONMEBOL'],
    ['BO', 'Bolívia', 'CONMEBOL'],
    ['VE', 'Venezuela', 'CONMEBOL'],
    ['MX', 'México', 'CONCACAF'],
    ['GB-ENG', 'Inglaterra', 'UEFA'],
    ['ES', 'Espanha', 'UEFA'],
    ['IT', 'Itália', 'UEFA'],
    ['DE', 'Alemanha', 'UEFA'],
    ['FR', 'França', 'UEFA'],
    ['PT', 'Portugal', 'UEFA'],
  ] as const
).map(([code, label, group]) => ({ code, label, group, href: `/paises/${code.toLowerCase()}` }));

export const sportBySlug = (slug: string) => SPORTS.find((s) => s.slug === slug);
export const countryByCode = (code: string) =>
  COUNTRIES.find((c) => c.code.toLowerCase() === code.toLowerCase());
