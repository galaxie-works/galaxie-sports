import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Flag, HistoryBadge } from '@/components/equestrian/parts';
import { Section } from '@/components/sport/section';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  equestrianAthletesRequest,
  getEquestrianAthletes,
  type AthleteFilters,
} from '@/lib/galaxie/equestrian';
import { getI18n } from '@/lib/i18n/server';
import { equestrianParent } from '@/lib/navigation';
import { fill } from '@/lib/i18n/text';

type Props = PageProps<'/[locale]/hipismo/atletas'>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

const COUNTRIES = ['ARG', 'BRA', 'CHI', 'URU'] as const;
const COVERAGES = ['complete', 'partial', 'not_collected'] as const;

async function Content({ searchParams }: Props) {
  const sp = await searchParams;
  const { locale, t } = await getI18n();
  const te = t.equestrian;
  const country = one(sp.country);
  const coverage = one(sp.coverage);
  const q = one(sp.q);
  const filters: AthleteFilters = {
    q: q && q.trim().length >= 2 ? q.trim() : undefined,
    country: country && /^[A-Z]{3}$/.test(country) ? country : undefined,
    coverage: coverage && (COVERAGES as readonly string[]).includes(coverage) ? coverage : undefined,
    cursor: one(sp.cursor),
  };
  const page = await getEquestrianAthletes(locale, filters);
  const nextHref = page.next_cursor
    ? `?${new URLSearchParams({
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.country ? { country: filters.country } : {}),
        ...(filters.coverage ? { coverage: filters.coverage } : {}),
        cursor: page.next_cursor,
      }).toString()}`
    : null;
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Section
        title={te.athletes.title}
        description={te.athletes.description}
        api={equestrianAthletesRequest(locale, { ...filters, cursor: undefined })}
      >
        <form className="flex flex-wrap items-end gap-2">
          <Input
            name="q"
            defaultValue={filters.q}
            placeholder={te.athletes.search}
            aria-label={te.athletes.search}
            className="w-64"
          />
          <select
            name="country"
            defaultValue={filters.country ?? ''}
            aria-label={te.athlete.competingFor}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            <option value="">{te.athletes.allCountries}</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            name="coverage"
            defaultValue={filters.coverage ?? ''}
            aria-label={te.athlete.coverageTitle}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            <option value="">{te.athletes.anyCoverage}</option>
            {COVERAGES.map((c) => (
              <option key={c} value={c}>
                {te.history[c]}
              </option>
            ))}
          </select>
          <Button type="submit">{te.athletes.apply}</Button>
        </form>
        {page.data.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {page.data.map((a) => (
              <Link key={a.id} href={`/hipismo/atletas/${a.id}`} className="group/entry">
                <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
                  <CardContent className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-2 font-medium">
                      <Flag country={a.country} />
                      <span className="truncate">{a.name}</span>
                    </span>
                    <HistoryBadge coverage={a.history_coverage} t={te} />
                    <span className="text-muted-foreground text-xs">
                      {fill(te.highlights.results, { n: a.results })} ·{' '}
                      {fill(te.highlights.wins, { n: a.wins })}
                      {a.first_result && a.last_result
                        ? ` · ${a.first_result.slice(0, 4)}–${a.last_result.slice(0, 4)}`
                        : ''}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{te.athletes.empty}</p>
        )}
        {nextHref ? (
          <div>
            <Button variant="outline" nativeButton={false} render={<Link href={nextHref} />}>
              {te.athletes.more}
            </Button>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

export default async function EquestrianAthletesPage(props: Props) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.equestrian.athletes.title} kind="esporte" parents={[equestrianParent(t)]} />
      <Suspense
        fallback={
          <div className="grid grid-cols-2 gap-3 p-4 md:p-6 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        }
      >
        <Content {...props} />
      </Suspense>
    </>
  );
}
