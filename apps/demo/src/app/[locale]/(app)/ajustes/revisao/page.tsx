import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsNav } from '@/components/admin/settings-nav';
import { PageHeader } from '@/components/app-shell/page-header';
import { ReviewFiltersBar } from '@/components/review/review-filter-bar';
import { ReviewTable } from '@/components/review/review-table';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { ReviewUnavailableError, listReviewItems, readServingFloor } from '@/lib/review/store';
import { REVIEW_STATES, parseFilters } from '@/lib/review/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.review.meta.title };
}

type SearchParams = PageProps<'/[locale]/ajustes/revisao'>['searchParams'];

async function List({ searchParams }: { searchParams: SearchParams }) {
  // Sessão de admin (headers), filtros (URL) e fuso (cookie): fica fora do shell estático.
  await requireAdmin();
  const [t, timeZone] = await Promise.all([getT(), getTimeZone()]);
  const filters = parseFilters(await searchParams);
  try {
    const [data, serving] = await Promise.all([
      listReviewItems(filters, t.review.summary),
      readServingFloor(),
    ]);
    const catalogEmpty = !REVIEW_STATES.some((s) => data.counts[s]) && !data.options.sports.length;
    return (
      <>
        {serving.floor ? (
          <p className="bg-muted w-fit rounded-md px-3 py-1.5 text-sm">
            {fill(t.review.serving.banner, { floor: serving.floor })}
          </p>
        ) : null}
        <ReviewFiltersBar filters={filters} counts={data.counts} options={data.options} />
        {data.items.length ? (
          <ReviewTable items={data.items} total={data.total} filters={filters} timeZone={timeZone} />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyDescription>
                {catalogEmpty ? t.review.page.emptyCatalog : t.review.page.empty}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </>
    );
  } catch (err) {
    if (!(err instanceof ReviewUnavailableError)) throw err;
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{t.review.page.unavailableTitle}</EmptyTitle>
          <EmptyDescription>{t.review.page.unavailableDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
}

export default async function ReviewPage({ searchParams }: PageProps<'/[locale]/ajustes/revisao'>) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.review.page.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsNav active="review" />
        <p className="text-muted-foreground max-w-3xl text-sm">{t.review.page.description}</p>
        <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
          <List searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
