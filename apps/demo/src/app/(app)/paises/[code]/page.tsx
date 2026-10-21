import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { COUNTRIES, countryByCode } from '@/lib/navigation';

export function generateStaticParams() {
  return COUNTRIES.map((c) => ({ code: c.code.toLowerCase() }));
}

async function Content({ params }: { params: PageProps<'/paises/[code]'>['params'] }) {
  const { code } = await params;
  const country = countryByCode(code);
  if (!country) notFound();

  return (
    <>
      <PageHeader title={country.label} />
      <EmptyState
        title="Competições do país"
        description="Ligas nacionais, torneios continentais e seleções entram aqui."
      />
    </>
  );
}

export default function CountryPage({ params }: PageProps<'/paises/[code]'>) {
  return (
    <Suspense fallback={<PageHeader title={<Skeleton className="h-4 w-32" />} />}>
      <Content params={params} />
    </Suspense>
  );
}
