import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';

async function Content({ params }: { params: PageProps<'/eventos/[id]'>['params'] }) {
  const { id } = await params;
  return <EmptyState title="Evento em construção" description={`Identificador: ${id}`} />;
}

export default function Page({ params }: PageProps<'/eventos/[id]'>) {
  return (
    <>
      <PageHeader title="Evento" />
      <Suspense fallback={<Skeleton className="m-4 h-48" />}>
        <Content params={params} />
      </Suspense>
    </>
  );
}
