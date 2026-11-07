import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CardGridSkeleton, FramePanelSkeleton, TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { WidgetsPanel } from '@/components/client/widgets-panel';
import { entityFromDefaults } from '@/lib/builder/config';
import { CATALOG_TAB_PARAM, widgetFamily } from '@/lib/builder/sports';
import { builderDb, listWidgets } from '@/lib/builder/store';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.builder };
}

async function Widgets({
  searchParams,
}: {
  searchParams: PageProps<'/[locale]/cliente/builder'>['searchParams'];
}) {
  const [timeZone, params] = await Promise.all([getTimeZone(), searchParams]);
  const tab = params[CATALOG_TAB_PARAM];
  return (
    <ClientArea section="builder">
      {async ({ tenant }) => {
        const widgets = await listWidgets(builderDb(), tenant.id);
        return (
          <WidgetsPanel
            timeZone={timeZone}
            sports={tenant.sports}
            tab={typeof tab === 'string' ? tab : undefined}
            widgets={widgets.map((w) => ({
              id: w.id,
              kind: w.kind,
              name: w.name,
              version: w.version,
              updatedAt: w.updatedAt.toISOString(),
              entity: entityFromDefaults(w.config.defaults),
              family: widgetFamily(w.kind, w.config.defaults)?.id ?? null,
            }))}
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientBuilderPage({ searchParams }: PageProps<'/[locale]/cliente/builder'>) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.builder.title}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <Suspense
          fallback={
            <div className="flex flex-col gap-4">
              <FramePanelSkeleton>
                <CardGridSkeleton bare count={6} media={null} footer={false} />
              </FramePanelSkeleton>
              <TablePanelSkeleton rows={4} />
            </div>
          }
        >
          <Widgets searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
