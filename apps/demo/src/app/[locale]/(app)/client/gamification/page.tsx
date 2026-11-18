import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { GamificationPanel } from '@/components/client/gamification-panel';
import { gamificationOverview } from '@/lib/client/gamification';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.gamification.meta.title };
}

async function Gamification({ country }: { country: string | undefined }) {
  return (
    <ClientArea section="gamification">
      {async ({ tenant }) => {
        // O tenant vem da sessão (ClientArea): o cliente só vê e muda os programas dele.
        const data = await gamificationOverview(tenant.id, country);
        return <GamificationPanel data={data} />;
      }}
    </ClientArea>
  );
}

export default async function ClientGamificationPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  const t = await getT();
  const { country } = await searchParams;
  return (
    <>
      <PageHeader
        title={t.gamification.title}
        kind="cliente"
        parents={[{ path: '/client', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton action rows={6} columns={['flex-1', 'w-28', 'w-24', 'w-16']} />
            </LoadingStatus>
          }
        >
          <Gamification country={country?.toUpperCase()} />
        </Suspense>
      </div>
    </>
  );
}
