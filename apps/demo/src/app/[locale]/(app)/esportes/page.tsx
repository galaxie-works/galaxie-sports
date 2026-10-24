import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { FamilyCard } from '@/components/explore/index-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { compactNumber } from '@/lib/explore';
import { exploreSummaryRequest, getExploreSummary } from '@/lib/galaxie/api';
import { exploreTotals, familyStats } from '@/lib/explore-index';
import { getI18n } from '@/lib/i18n/server';
import { plural } from '@/lib/i18n/text';
import type { TrailVisit } from '@/lib/trail';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.explore.sports };
}

/**
 * Índice de esportes (o "12 esportes" da home): as famílias do menu, cada uma com as competições e os jogos
 * da semana dos esportes dela. Os números vêm do mesmo resumo da home.
 */
async function Content() {
  const { locale, t } = await getI18n();
  const te = t.nav.explore;
  const summary = await getExploreSummary(locale).catch(() => null);
  const totals = exploreTotals(summary);
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{te.sports}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{te.index.sportsIntro}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {plural(locale, totals.sports, te.index.sportsCount)}
          {totals.upcoming === null
            ? null
            : ` · ${compactNumber(locale, totals.upcoming)} ${plural(locale, totals.upcoming, te.totals.upcoming)}`}
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {familyStats(summary).map((s) => (
          <li key={s.family.id} className="flex">
            <FamilyCard stats={s} t={t} locale={locale} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fallback() {
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:p-6 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 11 }, (_, i) => (
        <Skeleton key={i} className="h-48 rounded-xl" />
      ))}
    </div>
  );
}

export default async function SportsIndexPage() {
  const { locale, t } = await getI18n();
  const explore: TrailVisit = { path: '/', label: t.nav.explore.title, kind: 'explorar' };
  return (
    <>
      <PageHeader
        title={t.nav.explore.sports}
        kind="esporte"
        parents={[explore]}
        api={exploreSummaryRequest(locale)}
      />
      {/* contadores dependem da requisição: atrás de Suspense */}
      <Suspense fallback={<Fallback />}>
        <Content />
      </Suspense>
    </>
  );
}
