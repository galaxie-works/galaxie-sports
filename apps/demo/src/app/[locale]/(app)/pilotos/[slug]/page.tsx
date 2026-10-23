import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { TeamContent, TeamFallback, teamMetadata } from '@/components/pages/team-page';
import { apiSource } from '@/lib/galaxie/source';
import { idFromSlug } from '@/lib/navigation';

type Props = PageProps<'/[locale]/pilotos/[slug]'>;

/** O id do participante vem no fim do slug; slug sem id é "não encontrado". */
async function participantId(params: Props['params']) {
  const id = idFromSlug((await params).slug);
  if (!id) notFound();
  return { id };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = idFromSlug((await params).slug);
  return id ? teamMetadata(id, apiSource) : {};
}

/** Piloto (F1): `/pilotos/max-verstappen-<id>`, com campeonato, equipe e corridas. */
export default function DriverPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TeamFallback />}>
      <TeamContent params={participantId(params)} searchParams={searchParams} source={apiSource} />
    </Suspense>
  );
}
