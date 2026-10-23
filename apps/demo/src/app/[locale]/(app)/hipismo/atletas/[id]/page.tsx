import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { CoverageNote, Flag, HistoryBadge, NoticeBanner, SourceLink } from '@/components/equestrian/parts';
import { RankingsTable } from '@/components/equestrian/rankings-table';
import { ResultsTable } from '@/components/equestrian/results-table';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  equestrianAthleteRequest,
  equestrianResultsRequest,
  getEquestrianAthlete,
  getEquestrianResults,
  type ResultFilters,
} from '@/lib/galaxie/equestrian';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { equestrianParent } from '@/lib/navigation';
import { fill } from '@/lib/i18n/text';

type Props = PageProps<'/[locale]/hipismo/atletas/[id]'>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const isDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

async function Content({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { locale, t } = await getI18n();
  const te = t.equestrian;
  const filters: ResultFilters = {
    athlete: id,
    from: isDate(one(sp.from)),
    to: isDate(one(sp.to)),
    horse: one(sp.horse),
    podium: one(sp.podium) === 'true' ? 'true' : undefined,
    cursor: one(sp.cursor),
  };
  const [a, results, f] = await Promise.all([
    getEquestrianAthlete(id, locale),
    getEquestrianResults(locale, filters),
    getFormatters(),
  ]);
  const api = equestrianAthleteRequest(id, locale);
  const resultsApi = equestrianResultsRequest(locale, { ...filters, cursor: undefined });
  const period =
    a.stats.first_result && a.stats.last_result
      ? `${a.stats.first_result.slice(0, 4)}–${a.stats.last_result.slice(0, 4)}`
      : '—';
  const facts = [
    a.fei_id ? [te.athlete.feiId, a.fei_id] : null,
    a.country ? [te.athlete.competingFor, a.country.name ?? a.country.code] : null,
    a.nationality ? [te.athlete.nationality, a.nationality] : null,
    a.birth_date ? [te.athlete.birth, f.calendarDate(a.birth_date)] : null,
    a.registry_status ? [te.athlete.registry, a.registry_status] : null,
    [te.athlete.published, a.name_as_published],
  ].filter((x): x is [string, string] => x !== null);
  const hasFilters = !!(filters.from || filters.to || filters.horse || filters.podium);
  const nextHref = results.next_cursor
    ? `?${new URLSearchParams({
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.horse ? { horse: filters.horse } : {}),
        ...(filters.podium ? { podium: 'true' } : {}),
        cursor: results.next_cursor,
      }).toString()}`
    : null;

  return (
    <>
      <PageHeader title={a.name} kind="pessoa" parents={[equestrianParent(t)]} api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <Crest src={null} name={a.name} size="xl" round />
          <div className="flex flex-col gap-2">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Flag country={a.country} className="h-5 w-7" />
              {a.name}
            </h1>
            <div className="flex flex-wrap gap-1.5">
              <HistoryBadge coverage={a.coverage.history} t={te} />
              {a.championships.map((c) => (
                <Badge key={c.key} variant="secondary">
                  {c.name}
                </Badge>
              ))}
            </div>
            <SourceLink url={a.source.url} observedAt={a.source.observed_at} t={te} f={f} />
          </div>
        </div>

        <NoticeBanner notice={a.notice} t={te} />

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {facts.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{k}</dt>
              <dd className="text-sm font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              [te.athlete.stats.results, f.number(a.stats.results)],
              [te.athlete.stats.wins, f.number(a.stats.wins)],
              [te.athlete.stats.podiums, f.number(a.stats.podiums)],
              [te.athlete.stats.period, period],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} size="sm">
              <CardContent className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">{label}</span>
                <span className="text-2xl font-semibold tabular-nums">{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        <CoverageNote title={te.athlete.coverageTitle}>
          {a.coverage.note}
          {a.coverage.displayed_total_raw
            ? ` ${fill(te.athlete.displayed, { total: a.coverage.displayed_total_raw })}`
            : ''}
        </CoverageNote>

        {a.horses.length ? (
          <Section title={te.athlete.horses} description={te.athlete.horsesDescription} api={api}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {a.horses.slice(0, 12).map((h) => (
                <Link key={h.id} href={`/hipismo/cavalos/${h.id}`} className="group/entry">
                  <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
                    <CardContent className="flex flex-col gap-1">
                      <span className="truncate font-medium">🐴 {h.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {[h.breed, h.age !== null ? fill(te.horse.age, { n: h.age }) : null]
                          .filter(Boolean)
                          .join(' · ') || te.horse.pendingProfile}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {fill(te.athlete.horseResults, { n: h.results })}
                        {h.best_position ? ` · ${fill(te.athlete.best, { n: h.best_position })}` : ''}
                        {h.first && h.last ? ` · ${h.first.slice(0, 4)}–${h.last.slice(0, 4)}` : ''}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title={te.athlete.results} description={te.athlete.resultsDescription} api={resultsApi}>
          <form className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              {te.filters.from}
              <Input type="date" name="from" defaultValue={filters.from} className="w-40" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {te.filters.to}
              <Input type="date" name="to" defaultValue={filters.to} className="w-40" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {te.filters.horse}
              <select
                name="horse"
                defaultValue={filters.horse ?? ''}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                <option value="">{te.filters.anyHorse}</option>
                {a.horses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="podium" value="true" defaultChecked={!!filters.podium} />
              {te.filters.podium}
            </label>
            <Button type="submit">{te.filters.apply}</Button>
            {hasFilters ? (
              <Button variant="ghost" nativeButton={false} render={<Link href={`/hipismo/atletas/${id}`} />}>
                {te.filters.clear}
              </Button>
            ) : null}
          </form>
          {results.data.length ? (
            <ResultsTable rows={results.data} t={te} f={f} showAthlete={false} />
          ) : (
            <p className="text-muted-foreground text-sm">{te.filters.empty}</p>
          )}
          {nextHref ? (
            <div>
              <Button variant="outline" nativeButton={false} render={<Link href={nextHref} />}>
                {te.filters.more}
              </Button>
            </div>
          ) : null}
        </Section>

        {a.stats.prize_by_currency.length ? (
          <Section title={te.athlete.prizes} description={te.athlete.prizesNote} api={api}>
            <div className="flex flex-wrap gap-3">
              {a.stats.prize_by_currency.map((p) => (
                <Card key={p.currency} size="sm">
                  <CardContent className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">{p.currency}</span>
                    <span className="text-lg font-semibold tabular-nums">{f.number(p.amount)}</span>
                    <span className="text-muted-foreground text-xs">
                      {fill(te.athlete.horseResults, { n: p.results })}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </Section>
        ) : null}

        {a.championships.length ? (
          <Section title={te.athlete.championships} api={api}>
            <div className="flex flex-wrap gap-2">
              {a.championships.map((c) => (
                <Button
                  key={c.key}
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/hipismo/campeonatos/${c.key}?atleta=${a.id}`} />}
                >
                  {c.name} · {fill(te.championships.rounds, { n: c.rounds })}
                </Button>
              ))}
            </div>
          </Section>
        ) : null}

        {a.rankings.length ? (
          <Section title={te.rankings.title} description={te.rankings.description} api={api}>
            <RankingsTable rows={a.rankings} t={te} f={f} />
          </Section>
        ) : null}

        {a.disagreements.length ? (
          <Section
            title={te.athlete.disagreements}
            description={te.athlete.disagreementsDescription}
            api={api}
          >
            <div className="flex flex-col gap-2">
              {a.disagreements.map((d) => (
                <Card key={d.id} size="sm">
                  <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                    <code className="text-xs">{d.field}</code>
                    {d.values.map((v) => (
                      <span key={v.label} className="flex items-center gap-1">
                        <Badge variant="outline">
                          {(te.athlete.sources as Record<string, string>)[v.label] ?? v.label}
                        </Badge>
                        <span className="font-medium tabular-nums">{v.value ?? te.missing}</span>
                        {v.url ? <SourceLink url={v.url} page={v.page} t={te} f={f} /> : null}
                      </span>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </>
  );
}

export default function EquestrianAthletePage(props: Props) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="flex items-center gap-4 p-4 md:p-6">
            <Skeleton className="size-24 rounded-full" />
            <Skeleton className="h-7 w-48" />
          </div>
        </>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}
