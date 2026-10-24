import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { ChannelListPortal } from '@/components/channel-list/portal';
import { ClientArea } from '@/components/client/client-area';
import { Skeleton } from '@/components/ui/skeleton';
import { readChannelListPortal } from '@/lib/channel-list/server';
import { WTW_MARKETS } from '@/lib/channel-list/types';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.channels.meta.title };
}

async function Channels() {
  const timeZone = await getTimeZone();
  return (
    <ClientArea section="channels">
      {async ({ tenant }) => {
        // O tenant vem da sessão (ClientArea): o cliente só vê e muda a lista dele.
        const view = await readChannelListPortal(tenant.id);
        const markets = tenant.markets.length
          ? WTW_MARKETS.filter((m) => tenant.markets.includes(m))
          : [...WTW_MARKETS];
        return <ChannelListPortal view={view} markets={markets} timeZone={timeZone} />;
      }}
    </ClientArea>
  );
}

export default async function ClientChannelsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.channels.title}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Channels />
        </Suspense>
      </div>
    </>
  );
}
