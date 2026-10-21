import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { SPORTS, sportBySlug } from '@/lib/navigation';

export function generateStaticParams() {
  return SPORTS.map((s) => ({ sport: s.slug }));
}

async function Content({ params }: { params: PageProps<'/esportes/[sport]'>['params'] }) {
  const { sport: slug } = await params;
  const sport = sportBySlug(slug);
  if (!sport) notFound();

  return (
    <>
      <PageHeader title={sport.label} />
      <EmptyState
        title={`Sem eventos de ${sport.label.toLowerCase()} por enquanto`}
        description="Este esporte ainda não tem competições sincronizadas. Avisaremos quando houver novidade."
      />
    </>
  );
}

export default function SportPage({ params }: PageProps<'/esportes/[sport]'>) {
  return (
    <Suspense fallback={<PageHeader title={<Skeleton className="h-4 w-32" />} />}>
      <Content params={params} />
    </Suspense>
  );
}
