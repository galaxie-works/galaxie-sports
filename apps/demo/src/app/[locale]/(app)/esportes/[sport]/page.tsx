import type { CompetitionSummary } from '@galaxie/contracts';
import { Globe } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { CountryFlag } from '@/components/sport/country-flag';
import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getSportCompetitions, sportCompetitionsRequest } from '@/lib/galaxie/api';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { COUNTRIES, sportBySlug } from '@/lib/navigation';

/** Chave do grupo das competições sem país (o rótulo vem do dicionário). */
const INTERNATIONAL = 'international';

/**
 * Países da navegação primeiro (na ordem do menu), depois internacionais e o resto em ordem alfabética.
 * Países do menu usam o nome do dicionário (o mesmo da sidebar); os demais, o que a API devolve.
 */
function groupByCountry(competitions: CompetitionSummary[], t: Dictionary, locale: Locale) {
  const countryNames = t.nav.countries as Record<string, string>;
  const groups = new Map<string, { label: string; code: string | null; items: CompetitionSummary[] }>();
  for (const c of competitions) {
    const code = c.country?.code ?? null;
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
    g.code && navOrder.has(g.code) ? navOrder.get(g.code)! : g.code === null ? 100 : 200;
  return [...groups.values()]
    .map((g) => ({
      ...g,
      items: g.items.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, locale)),
    }))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, locale));
}

async function Content({ params }: { params: PageProps<'/[locale]/esportes/[sport]'>['params'] }) {
  const { sport: slug } = await params;
  const sport = sportBySlug(slug);
  if (!sport) notFound();
  const { locale, t } = await getI18n();
  const ts = t.pages.sport;
  const label = t.nav.sports[sport.slug];
  const competitions = await getSportCompetitions(sport.slug, locale);
  const groups = groupByCountry(competitions, t, locale);
  const api = sportCompetitionsRequest(sport.slug, locale);

  return (
    <>
      <PageHeader title={label} kind="esporte" api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          <p className="text-muted-foreground text-sm">
            {competitions.length
              ? fill(ts.summary, {
                  competitions: plural(locale, competitions.length, ts.catalogedCompetitions),
                  groups: plural(locale, groups.length, ts.groups),
                })
              : ts.catalogPending}
          </p>
        </div>

        {groups.length === 0 ? (
          <EmptyState title={fill(ts.empty.title, { sport: label })} description={ts.empty.description} />
        ) : null}

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
                  href={`/paises/${countrySlug(g.code)}`}
                  className="text-primary text-xs hover:underline"
                >
                  {ts.seeCountry}
                </Link>
              ) : null
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.items.map((c) => (
                <Link
                  key={c.id}
                  href={`/competicoes/${c.slug}`}
                  className="group/entry focus-visible:outline-none"
                >
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
            </div>
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

export default function SportPage({ params }: PageProps<'/[locale]/esportes/[sport]'>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Content params={params} />
    </Suspense>
  );
}
