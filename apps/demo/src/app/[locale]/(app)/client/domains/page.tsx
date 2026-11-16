import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { DomainsPanel } from '@/components/client/domains-panel';
import { listDomains } from '@/lib/client/domains';
import { can } from '@/lib/client/permissions';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.domains };
}

async function Domains() {
  const timeZone = await getTimeZone();
  return (
    <ClientArea section="domains">
      {async (ctx) => (
        <DomainsPanel
          domains={await listDomains(ctx.tenant.id)}
          manage={can(ctx, 'domains.manage')}
          timeZone={timeZone}
        />
      )}
    </ClientArea>
  );
}

/** Cliente → Integrações → Domínios (#1136, F2): hosts da marca comprovados por registro TXT. */
export default async function ClientDomainsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.nav.domains}
        kind="cliente"
        parents={[{ path: '/client', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton action rows={3} columns={['flex-1', 'w-32', 'w-24', 'w-20']} />
            </LoadingStatus>
          }
        >
          <Domains />
        </Suspense>
      </div>
    </>
  );
}
