import type { Metadata } from 'next';
import { Suspense } from 'react';

import { TeamContent, TeamFallback, teamMetadata } from '@/components/pages/team-page';
import { apiSource } from '@/lib/galaxie/source';

export async function generateMetadata({ params }: PageProps<'/[locale]/times/[id]'>): Promise<Metadata> {
  return teamMetadata((await params).id, apiSource);
}

/** Time (clube, seleção, equipe de F1). Piloto e lutador redirecionam para /pilotos e /lutadores. */
export default function TeamPage({ params, searchParams }: PageProps<'/[locale]/times/[id]'>) {
  return (
    <Suspense fallback={<TeamFallback />}>
      <TeamContent params={params} searchParams={searchParams} source={apiSource} redirectIndividuals />
    </Suspense>
  );
}
