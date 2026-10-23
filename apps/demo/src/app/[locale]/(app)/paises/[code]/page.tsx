import type { CountryCompetitions } from '@galaxie/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { ShowMore } from '@/components/sport/show-more';
import { UrlTabs } from '@/components/sport/url-tabs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { countryCompetitionsRequest, getCountryCompetitions } from '@/lib/galaxie/api';
import { contentLocale } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { plural } from '@/lib/i18n/text';
import { countryHref } from '@/lib/navigation';

type CompetitionItem = CountryCompetitions['sports'][number]['groups'][number]['competitions'][number];

/** Esporte na URL (`?esporte=basketball`): um esporte por vez, em vez de 140 competições numa página só. */
const SPORT_PARAM = 'esporte';

/**
 * Ordem dos grupos: as competições de clubes juntas (nacionais, continentais, mundiais) e a seleção no fim.
 * A Libertadores fica logo depois das nacionais, que mostram só as primeiras (o resto atrás de "ver mais").
 */
const SCOPE_ORDER = ['domestic', 'continental_clubs', 'world_clubs', 'national_teams'];
const scopeRank = (scope: string) => {
  const i = SCOPE_ORDER.indexOf(scope);
  return i < 0 ? SCOPE_ORDER.length : i;
};

/** Título da aba do navegador (e do histórico): o nome da página, não só "Galaxie Sports". */
export async function generateMetadata({ params }: PageProps<'/[locale]/paises/[code]'>): Promise<Metadata> {
  const [{ code }, { locale, t }] = await Promise.all([params, getI18n()]);
  if (!countryHref(code)) return {};
  try {
    const { country } = await getCountryCompetitions(code, locale);
    return { title: (t.nav.countries as Record<string, string>)[country.code] ?? country.name };
  } catch {
    return {};
  }
}

function CompetitionCard({ c, typeLabel }: { c: CompetitionItem; typeLabel: string }) {
  const alias = c.nicknames.find((n) => n !== c.name);
  return (
    <Link href={`/competicoes/${c.slug}`} className="group/entry focus-visible:outline-none">
      <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
        <CardHeader className="flex flex-row items-center gap-3">
          <Crest src={c.logo} name={c.name} size="md" />
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="truncate">{c.name}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" size="sm">
                {typeLabel}
              </Badge>
              {c.current_season ? <span>{c.current_season.label}</span> : null}
              {alias ? <span className="truncate">· {alias}</span> : null}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}

async function Content({ params, searchParams }: PageProps<'/[locale]/paises/[code]'>) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  // código que não é de país (ex.: "world", de um link antigo): "não encontrado" em vez de erro da API
  if (!countryHref(code)) notFound();
  const { locale, t } = await getI18n();
  const tc = t.pages.country;
  // competições na voz do próprio país (Chile em es-CL); em pt-BR, em português
  const content = contentLocale(locale, code);
  const data = await getCountryCompetitions(code, content);
  const { country } = data;
  // Países do menu usam o nome do dicionário (o mesmo da sidebar); os demais, o que a API devolve.
  const name = (t.nav.countries as Record<string, string>)[country.code] ?? country.name;
  const sportNames = t.nav.sports as Record<string, string>;
  const api = countryCompetitionsRequest(code, locale, content);
  const totalCompetitions = data.sports.reduce(
    (n, s) => n + s.groups.reduce((m, g) => m + g.competitions.length, 0),
    0,
  );
  const countOf = (s: (typeof data.sports)[number]) =>
    s.groups.reduce((n, g) => n + g.competitions.length, 0);
  // futebol primeiro quando houver (o esporte que a pessoa mais procura); `?esporte=` escolhe outro
  const requested = data.sports.find((s) => s.sport.slug === query[SPORT_PARAM]);
  const selected = (requested ?? data.sports.find((s) => s.sport.slug === 'football') ?? data.sports[0])
    ?.sport.slug;

  return (
    <>
      <PageHeader title={name} kind="país" api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex items-center gap-4">
          <Crest src={country.flag} name={name} size="lg" />
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              {country.confederation ? (
                <Badge variant="primary-light">{country.confederation.name}</Badge>
              ) : null}
              {country.ioc_code ? <span className="font-mono text-xs">{country.ioc_code}</span> : null}
              <span>· {plural(locale, totalCompetitions, tc.competitions)}</span>
            </div>
          </div>
        </div>

        {data.sports.length === 0 ? (
          <EmptyState title={tc.empty.title} description={tc.empty.description} />
        ) : null}

        {selected ? (
          <UrlTabs param={SPORT_PARAM} value={selected} className="gap-6">
            {data.sports.length > 1 ? (
              // muitos esportes não cabem no celular: a fileira rola na horizontal
              <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 py-0.5 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <TabsList>
                  {data.sports.map((s) => (
                    <TabsTrigger key={s.sport.slug} value={s.sport.slug}>
                      {sportNames[s.sport.slug] ?? s.sport.name}
                      <span className="text-muted-foreground text-xs tabular-nums">{countOf(s)}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            ) : null}
            {data.sports.map((s) => (
              <TabsContent key={s.sport.slug} value={s.sport.slug} className="flex flex-col gap-8">
                {[...s.groups]
                  .sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope))
                  .map((g) => (
                    <Section
                      key={g.scope}
                      title={tc.scopes[g.scope] ?? g.label}
                      description={plural(locale, g.competitions.length, tc.competitions)}
                      api={api}
                    >
                      <ShowMore
                        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                        items={g.competitions.map((c) => (
                          <CompetitionCard
                            key={c.id}
                            c={c}
                            typeLabel={t.sport.competitionType[c.type] ?? c.type}
                          />
                        ))}
                      />
                    </Section>
                  ))}
              </TabsContent>
            ))}
          </UrlTabs>
        ) : null}
      </div>
    </>
  );
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

export default function CountryPage(props: PageProps<'/[locale]/paises/[code]'>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Content {...props} />
    </Suspense>
  );
}
