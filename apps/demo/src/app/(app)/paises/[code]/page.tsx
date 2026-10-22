import type { CountryCompetitions } from '@galaxie/contracts';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { countryCompetitionsRequest, getCountryCompetitions } from '@/lib/galaxie/api';
import { COMPETITION_TYPE_LABEL } from '@/lib/format';

type CompetitionItem = CountryCompetitions['sports'][number]['groups'][number]['competitions'][number];

function CompetitionCard({ c }: { c: CompetitionItem }) {
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
                {COMPETITION_TYPE_LABEL[c.type] ?? c.type}
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

async function Content({ params }: { params: PageProps<'/paises/[code]'>['params'] }) {
  const { code } = await params;
  const data = await getCountryCompetitions(code);
  const { country } = data;
  const api = countryCompetitionsRequest(code);
  const totalCompetitions = data.sports.reduce(
    (n, s) => n + s.groups.reduce((m, g) => m + g.competitions.length, 0),
    0,
  );

  return (
    <>
      <PageHeader title={country.name} kind="país" api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex items-center gap-4">
          <Crest src={country.flag} name={country.name} size="lg" />
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{country.name}</h1>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              {country.confederation ? (
                <Badge variant="primary-light">{country.confederation.name}</Badge>
              ) : null}
              {country.ioc_code ? <span className="font-mono text-xs">{country.ioc_code}</span> : null}
              <span>· {totalCompetitions} competições</span>
            </div>
          </div>
        </div>

        {data.sports.length === 0 ? (
          <EmptyState
            title="Sem competições catalogadas"
            description="Este país ainda não tem competições no catálogo."
          />
        ) : null}

        {data.sports.map((s) => (
          <div key={s.sport.slug} className="flex flex-col gap-6">
            {data.sports.length > 1 ? <h2 className="text-lg font-semibold">{s.sport.name}</h2> : null}
            {s.groups.map((g) => (
              <Section
                key={g.scope}
                title={g.label}
                description={`${g.competitions.length} competições`}
                api={api}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {g.competitions.map((c) => (
                    <CompetitionCard key={c.id} c={c} />
                  ))}
                </div>
              </Section>
            ))}
          </div>
        ))}
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

export default function CountryPage({ params }: PageProps<'/paises/[code]'>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Content params={params} />
    </Suspense>
  );
}
