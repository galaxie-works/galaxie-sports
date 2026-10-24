import type { Metadata } from 'next';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { LineupPortal } from '@/components/lineup/portal';
import { Skeleton } from '@/components/ui/skeleton';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { readOperatorPortal } from '@/lib/lineup/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.lineup.meta.portal };
}

async function Lineup() {
  const [t, timeZone] = await Promise.all([getT(), getTimeZone()]);
  return (
    <ClientArea section="lineup">
      {async ({ tenant }) => {
        // O tenant vem da sessão (ClientArea): a operadora só vê a grade e os pedidos dela.
        const data = await readOperatorPortal(tenant.id);
        if (!data.operator?.platformId)
          return (
            <EmptyState title={t.lineup.portal.emptyTitle} description={t.lineup.portal.emptyDescription} />
          );
        return (
          <LineupPortal
            lineup={data.lineup}
            showOtherOperators={data.operator.showOtherOperators}
            pending={data.pending}
            requests={data.requests}
            library={data.library}
            timeZone={timeZone}
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientLineupPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.lineup.portal.title}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Lineup />
        </Suspense>
      </div>
    </>
  );
}
