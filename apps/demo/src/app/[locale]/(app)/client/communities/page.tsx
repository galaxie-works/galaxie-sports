import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { CommunitiesPanel } from '@/components/client/communities-panel';
import { communitiesOverview } from '@/lib/client/communities';
import { getRequestLocale, getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.communities.meta.title };
}

async function Communities() {
  const [timeZone, locale] = await Promise.all([getTimeZone(), getRequestLocale()]);
  return (
    <ClientArea section="communities">
      {async ({ tenant, role }) => {
        // O tenant vem da sessão (ClientArea): o cliente só vê e muda as Comunidades dele.
        const data = await communitiesOverview(tenant.id, locale);
        return <CommunitiesPanel data={data} galaxie={role === 'admin'} timeZone={timeZone} />;
      }}
    </ClientArea>
  );
}

export default async function ClientCommunitiesPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.communities.title}
        kind="cliente"
        parents={[{ path: '/client', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton action rows={4} columns={['flex-1', 'w-32', 'w-24', 'w-16']} />
            </LoadingStatus>
          }
        >
          <Communities />
        </Suspense>
      </div>
    </>
  );
}
