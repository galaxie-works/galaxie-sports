import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { FormCardSkeleton } from '@/components/app-shell/skeletons';
import { ChannelListPortal } from '@/components/channel-list/portal';
import { ClientArea } from '@/components/client/client-area';
import { ChannelImport } from '@/components/cosmos/channel-import';
import { readChannelListPortal } from '@/lib/channel-list/server';
import { unmatchedChannels, WTW_MARKETS } from '@/lib/channel-list/types';
import { channelImportAccess, channelImportMinimum } from '@/lib/cosmos/channel-import-tasks';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.channels.meta.title };
}

async function Channels() {
  const timeZone = await getTimeZone();
  return (
    <ClientArea section="channels">
      {async (ctx) => {
        const { tenant } = ctx;
        // O tenant vem da sessão (ClientArea): o cliente só vê e muda a lista dele.
        // Cosmos (#1008): ler a grade de PDF, print ou planilha, para quem pode usar e com a função ativa
        const [view, cosmosMin] = await Promise.all([
          readChannelListPortal(tenant.id),
          channelImportAccess(ctx) ? null : channelImportMinimum(),
        ]);
        const markets = tenant.markets.length
          ? WTW_MARKETS.filter((m) => tenant.markets.includes(m))
          : [...WTW_MARKETS];
        return (
          <div className="flex flex-col gap-4">
            {cosmosMin != null ? (
              <ChannelImport
                minCredits={ctx.role === 'admin' ? null : cosmosMin}
                country={markets.length === 1 ? markets[0]! : null}
                unmatched={view ? unmatchedChannels(view).map((c) => c.name) : []}
              />
            ) : null}
            <ChannelListPortal view={view} markets={markets} timeZone={timeZone} />
          </div>
        );
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
        <Suspense
          fallback={
            <LoadingStatus>
              <FormCardSkeleton fields={3} />
            </LoadingStatus>
          }
        >
          <Channels />
        </Suspense>
      </div>
    </>
  );
}
