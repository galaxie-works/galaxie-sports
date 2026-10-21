import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';

async function Content({ params }: { params: PageProps<'/times/[id]'>['params'] }) {
  const { id } = await params;
  return <EmptyState title="Time em construção" description={`Identificador: ${id}`} />;
}

export default function Page({ params }: PageProps<'/times/[id]'>) {
  return (
    <>
      <PageHeader title="Time" />
      <Suspense fallback={<Skeleton className="m-4 h-48" />}>
        <Content params={params} />
      </Suspense>
    </>
  );
}
