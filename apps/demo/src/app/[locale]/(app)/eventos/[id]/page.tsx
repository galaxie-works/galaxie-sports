import type { Metadata } from 'next';
import { Suspense } from 'react';

import { EventContent, EventFallback, eventMetadata } from '@/components/pages/event-page';
import { apiSource } from '@/lib/galaxie/source';

export async function generateMetadata({ params }: PageProps<'/[locale]/eventos/[id]'>): Promise<Metadata> {
  return eventMetadata((await params).id, apiSource);
}

export default function EventPage({ params, searchParams }: PageProps<'/[locale]/eventos/[id]'>) {
  return (
    <Suspense fallback={<EventFallback />}>
      <EventContent params={params} searchParams={searchParams} source={apiSource} />
    </Suspense>
  );
}
