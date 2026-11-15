import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PersonContent, PersonFallback, personMetadata } from '@/components/pages/person-page';
import { apiSource } from '@/lib/galaxie/source';

export async function generateMetadata({ params }: PageProps<'/[locale]/people/[id]'>): Promise<Metadata> {
  return personMetadata((await params).id, apiSource);
}

export default function PersonPage({ params, searchParams }: PageProps<'/[locale]/people/[id]'>) {
  return (
    <Suspense fallback={<PersonFallback />}>
      <PersonContent params={params} searchParams={searchParams} source={apiSource} />
    </Suspense>
  );
}
