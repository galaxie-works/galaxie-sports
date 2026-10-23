import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { ReviewDetail } from '@/components/review/review-detail';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { previewFor } from '@/lib/review/preview';
import { ReviewUnavailableError, getReviewItem } from '@/lib/review/store';
import { filtersQuery, parseFilters } from '@/lib/review/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.review.meta.title };
}

type Props = PageProps<'/[locale]/ajustes/revisao/[id]'>;

async function Detail({ params, searchParams }: Pick<Props, 'params' | 'searchParams'>) {
  await requireAdmin();
  const [{ id }, query, t, timeZone] = await Promise.all([params, searchParams, getT(), getTimeZone()]);
  // a lista manda os filtros dela em `lista`; o "voltar" e a trilha voltam para a mesma página filtrada
  const lista = typeof query.lista === 'string' ? query.lista : '';
  const listHref = `/ajustes/revisao${filtersQuery(parseFilters(new URLSearchParams(lista)))}`;
  const parents = [{ path: listHref, label: t.review.page.title, kind: 'ajustes' as const }];
  try {
    const item = await getReviewItem(decodeURIComponent(id));
    if (!item) notFound();
    return (
      <>
        <PageHeader title={item.title} kind="ajustes" parents={parents} />
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            render={<Link href={listHref} />}
            nativeButton={false}
          >
            <ArrowLeft />
            {t.review.detail.back}
          </Button>
          <ReviewDetail item={item} preview={previewFor(item)} timeZone={timeZone} />
        </div>
      </>
    );
  } catch (err) {
    if (!(err instanceof ReviewUnavailableError)) throw err;
    return (
      <>
        <PageHeader title={t.review.page.title} kind="ajustes" parents={parents} />
        <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>{t.review.page.unavailableTitle}</EmptyTitle>
              <EmptyDescription>{t.review.page.unavailableDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    );
  }
}

export default function ReviewItemPage({ params, searchParams }: Props) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
            <Skeleton className="h-96 w-full" />
          </div>
        </>
      }
    >
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}
