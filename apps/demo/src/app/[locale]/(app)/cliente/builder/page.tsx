import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { WidgetsPanel } from '@/components/client/widgets-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { entityFromDefaults } from '@/lib/builder/config';
import { builderDb, listWidgets } from '@/lib/builder/store';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.builder };
}

async function Widgets() {
  const timeZone = await getTimeZone();
  return (
    <ClientArea section="builder">
      {async ({ tenant }) => {
        const widgets = await listWidgets(builderDb(), tenant.id);
        return (
          <WidgetsPanel
            timeZone={timeZone}
            widgets={widgets.map((w) => ({
              id: w.id,
              kind: w.kind,
              name: w.name,
              version: w.version,
              updatedAt: w.updatedAt.toISOString(),
              entity: entityFromDefaults(w.config.defaults),
            }))}
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientBuilderPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.builder.title}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Widgets />
        </Suspense>
      </div>
    </>
  );
}
