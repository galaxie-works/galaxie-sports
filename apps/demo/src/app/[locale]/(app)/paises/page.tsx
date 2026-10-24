import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { CountryIndexCard } from '@/components/explore/index-cards';
import { CONFEDERATIONS } from '@/components/explore/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { exploreSummaryRequest, getExploreSummary } from '@/lib/galaxie/api';
import { exploreTotals } from '@/lib/explore-index';
import { getI18n } from '@/lib/i18n/server';
import { plural } from '@/lib/i18n/text';
import { COUNTRIES } from '@/lib/navigation';
import type { TrailVisit } from '@/lib/trail';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.explore.countries };
}

/**
 * Índice de países (o "17 países" da home): os países da navegação por confederação, cada um com bandeira,
 * liga principal, competições domésticas e jogos da semana. Os números vêm do mesmo resumo da home.
 */
async function Content() {
  const { locale, t } = await getI18n();
  const te = t.nav.explore;
  const summary = await getExploreSummary(locale).catch(() => null);
  const totals = exploreTotals(summary);
  const data = new Map(summary?.countries.map((c) => [c.code, c]));
  return (
    <div className="flex flex-col gap-8 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{te.countries}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{te.index.countriesIntro}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {totals.countries} {plural(locale, totals.countries, te.totals.countries)}
        </p>
      </div>
      {CONFEDERATIONS.map((group) => {
        const countries = COUNTRIES.filter((c) => c.group === group);
        return (
          <section key={group} aria-labelledby={`conf-${group}`} className="flex flex-col gap-3">
            <h2 id={`conf-${group}`} className="flex items-center gap-3 border-b pb-2.5">
              <span className="bg-primary h-6 w-1 rounded-full" aria-hidden />
              <span className="text-lg font-bold tracking-[0.14em]">{group}</span>
              <span className="text-muted-foreground text-sm font-medium">{t.nav.groups[group]}</span>
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {countries.map((c) => (
                <li key={c.code} className="flex">
                  <CountryIndexCard
                    country={c}
                    name={t.nav.countries[c.code]}
                    data={data.get(c.code)}
                    t={t}
                    locale={locale}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Fallback() {
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:p-6 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} className="h-32 rounded-xl" />
      ))}
    </div>
  );
}

export default async function CountriesIndexPage() {
  const { locale, t } = await getI18n();
  const explore: TrailVisit = { path: '/', label: t.nav.explore.title, kind: 'explorar' };
  return (
    <>
      <PageHeader
        title={t.nav.explore.countries}
        kind="país"
        parents={[explore]}
        api={exploreSummaryRequest(locale)}
      />
      <Suspense fallback={<Fallback />}>
        <Content />
      </Suspense>
    </>
  );
}
