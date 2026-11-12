import type { Metadata } from 'next';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TableCardSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { LineupReviewComposer } from '@/components/cosmos/lineup-review-composer';
import { LineupPortal } from '@/components/lineup/portal';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { lineupReviewAccess, lineupReviewMinimum } from '@/lib/cosmos/lineup-review-tasks';
import { readOperatorPortal } from '@/lib/lineup/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.lineup.meta.portal };
}

async function Lineup() {
  const [t, timeZone] = await Promise.all([getT(), getTimeZone()]);
  return (
    <ClientArea section="lineup">
      {async (ctx) => {
        // O tenant vem da sessão (ClientArea): a operadora só vê a grade e os pedidos dela.
        // Cosmos (#1008): pedido de revisão em texto livre, para quem pode usar e com a função ativa
        const [data, cosmosMin] = await Promise.all([
          readOperatorPortal(ctx.tenant.id),
          lineupReviewAccess(ctx) ? null : lineupReviewMinimum(),
        ]);
        if (!data.operator?.platformId)
          return (
            <EmptyState title={t.lineup.portal.emptyTitle} description={t.lineup.portal.emptyDescription} />
          );
        return (
          <div className="flex flex-col gap-4">
            {data.lineup && cosmosMin != null ? (
              <LineupReviewComposer minCredits={ctx.role === 'admin' ? null : cosmosMin} />
            ) : null}
            <LineupPortal
              lineup={data.lineup}
              showOtherOperators={data.operator.showOtherOperators}
              pending={data.pending}
              requests={data.requests}
              library={data.library}
              timeZone={timeZone}
            />
          </div>
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
        <Suspense
          fallback={
            <LoadingStatus>
              <TableCardSkeleton rows={6} columns={['flex-1', 'w-28', 'w-24', 'w-20']} />
            </LoadingStatus>
          }
        >
          <Lineup />
        </Suspense>
      </div>
    </>
  );
}
