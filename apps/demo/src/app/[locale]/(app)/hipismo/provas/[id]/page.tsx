import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { CoverageNote, Flag, NoticeBanner, SourceLink } from '@/components/equestrian/parts';
import { ResultsTable } from '@/components/equestrian/results-table';
import { Badge } from '@/components/reui/badge';
import { Section } from '@/components/sport/section';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { equestrianCompetitionRequest, getEquestrianCompetition } from '@/lib/galaxie/equestrian';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

type Props = PageProps<'/[locale]/hipismo/provas/[id]'>;

async function Content({ params }: Props) {
  const { id } = await params;
  const { locale, t } = await getI18n();
  const te = t.equestrian;
  const [c, f] = await Promise.all([getEquestrianCompetition(id, locale), getFormatters()]);
  const api = equestrianCompetitionRequest(id, locale);
  const judgings = te.competition.judgings as Record<string, string>;
  const facts = [
    [te.competition.level, c.level],
    [te.competition.date, c.date ? f.calendarDate(c.date) : null],
    [te.competition.venue, c.venue],
    [te.competition.height, c.height_cm ? `${c.height_cm} cm` : null],
    [te.competition.judging, c.judging ? (judgings[c.judging] ?? c.judging) : null],
    [te.competition.article, c.article],
    [
      te.competition.prize,
      c.prize
        ? c.prize.total !== null
          ? `${f.number(c.prize.total)} ${c.prize.currency ?? ''}`
          : c.prize.raw
        : null,
    ],
    [
      te.competition.show,
      c.show?.start && c.show.end ? `${f.calendarDate(c.show.start)} – ${f.calendarDate(c.show.end)}` : null,
    ],
  ].filter((x): x is [string, string] => !!x[1]);

  return (
    <>
      <PageHeader title={c.name} kind="evento" api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Flag country={c.country} className="h-5 w-7" />
            {c.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {c.level ? <Badge variant="outline">{c.level}</Badge> : null}
            {c.is_grand_prix ? <Badge variant="primary-light">{te.competition.gp}</Badge> : null}
            <Badge variant={c.completeness.all_entries_observed ? 'success-light' : 'warning-light'}>
              {c.completeness.all_entries_observed ? te.recent.full : te.recent.partial}
            </Badge>
            <SourceLink url={c.source.url} observedAt={c.source.observed_at} t={te} f={f} />
          </div>
          {c.article_text ? (
            <p className="text-muted-foreground max-w-3xl text-xs">{c.article_text}</p>
          ) : null}
        </div>

        <NoticeBanner notice={c.notice} t={te} />

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {facts.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{k}</dt>
              <dd className="text-sm font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <Section title={te.competition.standings} api={api}>
          <CoverageNote>
            {c.completeness.all_entries_observed ? te.competition.full : te.competition.partial}
            {c.completeness.displayed_entries !== null
              ? ` ${fill(te.competition.displayed, { n: c.completeness.displayed_entries })}`
              : ''}
          </CoverageNote>
          {c.championship_key ? (
            <div>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/hipismo/campeonatos/${c.championship_key}`} />}
              >
                {te.competition.viewChampionship}
              </Button>
            </div>
          ) : null}
          <ResultsTable rows={c.standings} t={te} f={f} showCompetition={false} />
        </Section>
      </div>
    </>
  );
}

export default function EquestrianCompetitionPage(props: Props) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="p-4 md:p-6">
            <Skeleton className="h-7 w-64" />
          </div>
        </>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}
