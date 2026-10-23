import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { CoverageNote, Flag, NoticeBanner, SourceLink } from '@/components/equestrian/parts';
import { RankingsTable } from '@/components/equestrian/rankings-table';
import { ResultsTable } from '@/components/equestrian/results-table';
import { Badge } from '@/components/reui/badge';
import { Section } from '@/components/sport/section';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  equestrianHorseRequest,
  equestrianResultsRequest,
  getEquestrianHorse,
  getEquestrianResults,
} from '@/lib/galaxie/equestrian';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { equestrianParent } from '@/lib/navigation';
import { fill } from '@/lib/i18n/text';

type Props = PageProps<'/[locale]/hipismo/cavalos/[id]'>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

async function Content({ params, searchParams }: Props) {
  const { id } = await params;
  const cursor = one((await searchParams).cursor);
  const { locale, t } = await getI18n();
  const te = t.equestrian;
  const [h, results, f] = await Promise.all([
    getEquestrianHorse(id, locale),
    getEquestrianResults(locale, { horse: id, cursor }),
    getFormatters(),
  ]);
  const api = equestrianHorseRequest(id, locale);
  const genders = te.horse.genders as Record<string, string>;
  const facts = [
    [te.athlete.feiId, h.fei_id],
    [te.horse.breed, h.breed],
    [te.horse.studbook, h.studbook],
    [
      te.horse.born,
      h.birth_date
        ? `${f.calendarDate(h.birth_date)}${h.age !== null ? ` · ${fill(te.horse.age, { n: h.age })}` : ''}`
        : null,
    ],
    [te.horse.gender, h.gender ? (genders[h.gender] ?? h.gender) : null],
    [te.horse.color, h.color],
    [te.horse.sire, h.sire],
    [te.horse.dam, h.dam],
    [te.horse.damSire, h.dam_sire],
    [te.horse.breeder, h.breeder],
    [te.horse.birthCountry, h.birth_country],
    [te.horse.adminNf, h.admin_nf],
  ] as [string, string | null][];

  return (
    <>
      <PageHeader title={h.name} kind="pessoa" parents={[equestrianParent(t)]} api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span aria-hidden>🐴</span>
            {h.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={h.profile === 'detailed' ? 'success-light' : 'warning-light'}>
              {te.horse.profile}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {fill(te.highlights.results, { n: h.stats.results })} ·{' '}
              {fill(te.highlights.wins, { n: h.stats.wins })}
            </span>
            <SourceLink url={h.source.url} observedAt={h.source.observed_at} t={te} f={f} />
          </div>
        </div>

        <NoticeBanner notice={h.notice} t={te} />

        <Section
          title={te.horse.profile}
          description={h.birth_date?.endsWith('-01-01') ? te.horse.bornNote : undefined}
          api={api}
        >
          {h.profile === 'pending' ? <CoverageNote>{te.horse.pendingProfile}</CoverageNote> : null}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">{k}</dt>
                <dd className="text-sm font-medium">
                  {v ?? <span className="text-muted-foreground/70 font-normal italic">{te.missing}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        {h.owners.length ? (
          <Section title={te.horse.owners} description={te.horse.ownersNote} api={api}>
            <div className="flex flex-wrap gap-2">
              {h.owners.map((o) => (
                <Badge key={`${o.name}-${o.since_raw}`} variant="outline" size="lg">
                  {o.name}
                  {o.nationality ? ` (${o.nationality})` : ''}
                  {o.since_raw ? ` · ${fill(te.horse.since, { date: o.since_raw })}` : ''}
                  {o.percentage_raw ? ` · ${o.percentage_raw}` : ''}
                </Badge>
              ))}
            </div>
          </Section>
        ) : null}

        {h.riders.length ? (
          <Section title={te.horse.riders} api={api}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {h.riders.map((r) => (
                <Link key={r.id} href={`/hipismo/atletas/${r.id}`} className="group/entry">
                  <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
                    <CardContent className="flex flex-col gap-1">
                      <span className="flex items-center gap-2 font-medium">
                        <Flag country={r.country} />
                        {r.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {fill(te.athlete.horseResults, { n: r.results })}
                        {r.first && r.last ? ` · ${r.first.slice(0, 4)}–${r.last.slice(0, 4)}` : ''}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title={te.horse.results} api={equestrianResultsRequest(locale, { horse: id })}>
          {results.data.length ? (
            <ResultsTable rows={results.data} t={te} f={f} showHorse={false} />
          ) : (
            <p className="text-muted-foreground text-sm">{te.filters.empty}</p>
          )}
          {results.next_cursor ? (
            <div>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`?cursor=${results.next_cursor}`} />}
              >
                {te.filters.more}
              </Button>
            </div>
          ) : null}
        </Section>

        {h.rankings.length ? (
          <Section title={te.rankings.title} description={te.rankings.description} api={api}>
            <RankingsTable rows={h.rankings} t={te} f={f} />
          </Section>
        ) : null}
      </div>
    </>
  );
}

export default function EquestrianHorsePage(props: Props) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="p-4 md:p-6">
            <Skeleton className="h-7 w-48" />
          </div>
        </>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}
