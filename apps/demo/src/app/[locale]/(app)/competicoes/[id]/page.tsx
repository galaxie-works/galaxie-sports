import type { Metadata } from 'next';
import { Suspense } from 'react';

import {
  CompetitionContent,
  CompetitionFallback,
  competitionMetadata,
} from '@/components/pages/competition-page';
import { apiSource } from '@/lib/galaxie/source';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/competicoes/[id]'>): Promise<Metadata> {
  return competitionMetadata((await params).id, apiSource);
}

export default function CompetitionPage({ params, searchParams }: PageProps<'/[locale]/competicoes/[id]'>) {
  return (
    <Suspense fallback={<CompetitionFallback />}>
      <CompetitionContent params={params} searchParams={searchParams} source={apiSource} />
    </Suspense>
  );
}
