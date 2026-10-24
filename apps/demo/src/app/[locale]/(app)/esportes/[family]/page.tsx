import type { CompetitionSummary } from '@galaxie/contracts';
import { Globe } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { CompetitionContent } from '@/components/pages/competition-page';
import { Badge } from '@/components/reui/badge';
import { CountryFlag } from '@/components/sport/country-flag';
import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { ShowMore } from '@/components/sport/show-more';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getExploreSummary, getSportCompetitions, sportCompetitionsRequest } from '@/lib/galaxie/api';
import { apiSource } from '@/lib/galaxie/source';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { COUNTRIES, countryHref, sportBySlug } from '@/lib/navigation';
import {
  familyBySlug,
  familyHref,
  familySections,
  mergeFamilyCompetitions,
  type SportFamily,
} from '@/lib/sport-families';

/** Título da aba do navegador (e do histórico): o nome da página, não só "Galaxie Sports". */
export async function generateMetadata({
  params,
}: PageProps<'/[locale]/esportes/[family]'>): Promise<Metadata> {
  const [{ family: slug }, { t }] = await Promise.all([params, getI18n()]);
  const family = familyBySlug(slug);
  return family ? { title: t.nav.families[family.id] } : {};
}

/** Chave do grupo das competições sem país (o rótulo vem do dicionário). */
const INTERNATIONAL = 'international';

/**
 * Internacionais primeiro (Libertadores, Champions, Copa do Mundo), depois os países da navegação (na
 * ordem do menu) e o resto em ordem alfabética. Dentro do grupo, os destaques (`featured`) na frente e
 * as nacionais antes das estaduais e regionais (`level`).
 * Países do menu usam o nome do dicionário (o mesmo da sidebar); os demais, o que a API devolve.
 */
function groupByCountry(
  competitions: CompetitionSummary[],
  t: Dictionary,
  locale: Locale,
  featured: Map<string, number>,
) {
  const countryNames = t.nav.countries as Record<string, string>;
  const groups = new Map<string, { label: string; code: string | null; items: CompetitionSummary[] }>();
  for (const c of competitions) {
    // "World" (mundiais, F1) não é país: entra no grupo internacional
    const code = c.country && countryHref(c.country.code) ? c.country.code : null;
    const key = code ?? INTERNATIONAL;
    const label = code
      ? (countryNames[code === 'GB' ? 'GB-ENG' : code] ?? c.country?.name ?? code)
      : t.pages.sport.international;
    const group = groups.get(key) ?? { label, code, items: [] };
    group.items.push(c);
    groups.set(key, group);
  }
  // Inglaterra pode vir como GB-ENG (api-sports) ou GB (ISO 3166-1).
  const navOrder = new Map(
    COUNTRIES.flatMap((c, i) =>
      c.code === 'GB-ENG'
        ? [
            [c.code, i],
            ['GB', i],
          ]
        : [[c.code, i]],
    ) as [string, number][],
  );
  const rank = (g: { code: string | null }) =>
    g.code === null ? -1 : navOrder.has(g.code) ? navOrder.get(g.code)! : 200;
  return [...groups.values()]
    .map((g) => ({ ...g, items: sortCompetitions(g.items, featured, locale) }))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, locale));
}

function sortCompetitions(items: CompetitionSummary[], featured: Map<string, number>, locale: Locale) {
  return [...items].sort(
    (a, b) =>
      (featured.get(a.slug) ?? Infinity) - (featured.get(b.slug) ?? Infinity) ||
      // nacionais (Série A a D, Copa do Brasil) antes dos estaduais e regionais, na ordem editorial da API
      Number(a.level === 'regional') - Number(b.level === 'regional') ||
      (a.order ?? Infinity) - (b.order ?? Infinity) ||
      a.tier - b.tier ||
      a.name.localeCompare(b.name, locale),
  );
}

/** Competições de todos os esportes da família, sem as repetidas entre as APIs. */
async function familyCompetitions(family: SportFamily, locale: Locale) {
  const lists = await Promise.all(
    family.sports.map(async (sport) => ({ sport, items: await getSportCompetitions(sport, locale) })),
  );
  return mergeFamilyCompetitions(family, lists);
}

function CompetitionGrid({ items, t }: { items: CompetitionSummary[]; t: Dictionary }) {
  return (
    <ShowMore
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      items={items.map((c) => (
        <Link key={c.id} href={`/competicoes/${c.slug}`} className="group/entry focus-visible:outline-none">
          <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
            <CardHeader className="flex flex-row items-center gap-3">
              <Crest src={c.logo} name={c.name} size="md" />
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle className="truncate">{c.name}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" size="sm">
                    {t.sport.competitionType[c.type] ?? c.type}
                  </Badge>
                  {c.current_season ? <span>{c.current_season.label}</span> : null}
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
      ))}
    />
  );
}

async function Content({
  params,
  searchParams,
}: Pick<PageProps<'/[locale]/esportes/[family]'>, 'params' | 'searchParams'>) {
  const { family: slug } = await params;
  const family = familyBySlug(slug);
  if (!family) notFound();
  const { locale, t } = await getI18n();
  const ts = t.pages.sport;
  const label = t.nav.families[family.id];
  const [lists, summary] = await Promise.all([
    familyCompetitions(family, locale),
    // sem o resumo, só perde a ordem por destaque (a lista segue por tier e nome)
    getExploreSummary(locale).catch(() => null),
  ]);
  const all = lists.flatMap((l) => l.items);

  // uma competição só (a F1 hoje): a página da família é o hub dela, sem a lista de um card
  if (all.length === 1) {
    return (
      <CompetitionContent
        params={Promise.resolve({ id: all[0]!.slug })}
        searchParams={searchParams}
        source={apiSource}
        mount={{ basePath: familyHref(family), title: label }}
      />
    );
  }

  // destaques da API primeiro em cada grupo (Champions e Libertadores antes da Conference League; a liga
  // principal de cada país antes dos estaduais); a ordem alfabética tirava os dois do que aparece
  const featured = new Map<string, number>([
    ...(summary?.countries ?? []).flatMap((c) =>
      c.main_competition ? [[c.main_competition.slug, 0] as const] : [],
    ),
    ...family.sports.flatMap((sport) =>
      (summary?.sports.find((x) => x.slug === sport)?.top_competitions ?? []).map(
        (c, i) => [c.slug, i] as const,
      ),
    ),
  ]);
  const sectionSports = familySections(family);
  // esportes com seção própria (a NBA dentro de Basquete) antes dos grupos por país
  const sections = sectionSports
    .map((sport) => ({
      sport,
      items: sortCompetitions(lists.find((l) => l.sport === sport)?.items ?? [], featured, locale),
    }))
    .filter((s) => s.items.length);
  const groups = groupByCountry(
    lists.filter((l) => !sectionSports.includes(l.sport)).flatMap((l) => l.items),
    t,
    locale,
    featured,
  );
  const api = sportCompetitionsRequest(family.sports[0], locale);
  const groupCount = sections.length + groups.length;

  return (
    <>
      <PageHeader title={label} kind="esporte" api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">
            {all.length
              ? fill(ts.summary, {
                  competitions: plural(locale, all.length, ts.catalogedCompetitions),
                  groups: plural(locale, groupCount, ts.groups),
                })
              : ts.catalogPending}
          </p>
        </div>

        {groupCount === 0 ? (
          <EmptyState title={fill(ts.empty.title, { sport: label })} description={ts.empty.description} />
        ) : null}

        {sections.map(({ sport, items }) => {
          const nav = sportBySlug(sport);
          const Icon = nav?.icon;
          return (
            // âncora da rota antiga (`/esportes/nba` → `/esportes/basquete#nba`)
            <div key={sport} id={sport} className="scroll-mt-20">
              <Section
                title={nav ? t.nav.sports[nav.slug] : sport}
                icon={Icon ? <Icon className="text-muted-foreground size-4" /> : null}
                description={plural(locale, items.length, ts.competitions)}
                api={sportCompetitionsRequest(sport, locale)}
              >
                <CompetitionGrid items={items} t={t} />
              </Section>
            </div>
          );
        })}

        {groups.map((g) => (
          <Section
            key={g.code ?? INTERNATIONAL}
            title={g.label}
            icon={g.code ? <CountryFlag code={g.code} /> : <Globe className="text-muted-foreground size-4" />}
            description={plural(locale, g.items.length, ts.competitions)}
            api={api}
            action={
              g.code && countrySlug(g.code) ? (
                <Link
                  href={`/paises/${countrySlug(g.code)}?esporte=${family.sports[0]}`}
                  className="text-primary text-xs hover:underline"
                >
                  {ts.seeCountry}
                </Link>
              ) : null
            }
          >
            <CompetitionGrid items={g.items} t={t} />
          </Section>
        ))}
      </div>
    </>
  );
}

/** Slug da página de país da demo para um código ISO (Inglaterra usa GB-ENG). */
function countrySlug(code: string): string | null {
  const match = COUNTRIES.find((c) => c.code === code || (code === 'GB' && c.code === 'GB-ENG'));
  return match ? match.code.toLowerCase() : null;
}

function Fallback() {
  return (
    <>
      <PageHeader title={<Skeleton className="h-4 w-32" />} />
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:p-6 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </>
  );
}

export default function FamilyPage({ params, searchParams }: PageProps<'/[locale]/esportes/[family]'>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}
