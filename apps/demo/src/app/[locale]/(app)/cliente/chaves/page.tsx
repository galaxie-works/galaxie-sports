import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { KeysPanel } from '@/components/client/keys-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { builderDb, listPublishableKeys, listWidgets } from '@/lib/builder/store';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.keys };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function Keys() {
  const timeZone = await getTimeZone();
  return (
    <ClientArea section="keys">
      {async ({ tenant }) => {
        const db = builderDb();
        const [keys, widgets] = await Promise.all([
          listPublishableKeys(db, tenant.id),
          listWidgets(db, tenant.id),
        ]);
        return (
          <KeysPanel
            keys={keys.map((k) => ({
              id: k.id,
              name: k.name,
              prefix: k.prefix,
              allowedOrigins: k.allowedOrigins,
              widgetId: k.widgetId,
              createdAt: k.createdAt.toISOString(),
              revokedAt: iso(k.revokedAt),
            }))}
            widgets={widgets.map((w) => ({ id: w.id, name: w.name }))}
            timeZone={timeZone}
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientKeysPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.nav.keys}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Keys />
        </Suspense>
      </div>
    </>
  );
}
