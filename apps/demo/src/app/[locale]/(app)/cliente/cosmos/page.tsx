import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { CosmosIcon } from '@/components/cosmos/cosmos-icon';
import { ExplainEmpty } from '@/components/settings';
import { Skeleton } from '@/components/ui/skeleton';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.cosmos };
}

/** Por enquanto só o vazio que explica: carteira, extrato e compra chegam com o #995. */
async function Cosmos() {
  const t = await getT();
  return (
    <ClientArea section="cosmos">
      {() => (
        <ExplainEmpty
          icon={CosmosIcon}
          title={t.client.cosmos.soon}
          description={t.client.cosmos.soonDescription}
          className="rounded-xl border"
        />
      )}
    </ClientArea>
  );
}

export default async function ClientCosmosPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.nav.cosmos}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <Skeleton className="h-64 w-full rounded-xl" />
            </LoadingStatus>
          }
        >
          <Cosmos />
        </Suspense>
      </div>
    </>
  );
}
