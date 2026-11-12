import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { EditorSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { WidgetEditor } from '@/components/client/widget-editor';
import { Skeleton } from '@/components/ui/skeleton';
import { marketsFor } from '@/lib/builder/config';
import { brandThemeItems, draftOf, guideChannelChoices } from '@/lib/builder/editor';
import { builderDb, getWidget } from '@/lib/builder/store';
import { requireClientContext } from '@/lib/client/session';
import { widgetTaskAccess, widgetTaskMinimums } from '@/lib/cosmos/widget-tasks';
import { isUuid } from '@/lib/client/tenants';
import { getI18n, getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.editor };
}

type Params = PageProps<'/[locale]/cliente/builder/[id]'>['params'];

async function Editor({ params }: { params: Params }) {
  const [{ id }, { locale, t }, ctx] = await Promise.all([params, getI18n(), requireClientContext()]);
  const widget = isUuid(id) ? await getWidget(builderDb(), id) : null;
  // Widget de outro tenant (ou arquivado) não existe para quem está vendo.
  if (!widget || !ctx.tenant || widget.tenantId !== ctx.tenant.id || widget.archivedAt) notFound();
  return (
    <>
      {/* O nome do widget vira o item da trilha; o painel e o Builder são os pais. */}
      <PageHeader
        title={widget.name}
        kind="cliente"
        parents={[
          { path: '/cliente', label: t.client.title, kind: 'cliente' },
          { path: '/cliente/builder', label: t.client.builder.title, kind: 'cliente' },
        ]}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
        <ClientArea section="builder">
          {async ({ tenant }) => {
            // instalação com a Cosmos (#1005): só para quem pode usar e com a função cadastrada no catálogo
            const minimums = widgetTaskAccess(ctx) ? null : await widgetTaskMinimums();
            return (
              <WidgetEditor
                key={`${widget.id}:${widget.version}`}
                initial={await draftOf(widget, locale)}
                saved={{ id: widget.id, version: widget.version }}
                markets={marketsFor(tenant.markets)}
                sports={tenant.sports}
                guideChannels={await guideChannelChoices(tenant.id)}
                brandThemes={await brandThemeItems(tenant.id)}
                cosmosInstall={
                  minimums?.install != null
                    ? { minCredits: ctx.role === 'admin' ? null : minimums.install }
                    : null
                }
              />
            );
          }}
        </ClientArea>
      </div>
    </>
  );
}

export default function WidgetPage({ params }: PageProps<'/[locale]/cliente/builder/[id]'>) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <LoadingStatus className="mx-auto w-full max-w-7xl p-4 md:p-6">
            <EditorSkeleton />
          </LoadingStatus>
        </>
      }
    >
      <Editor params={params} />
    </Suspense>
  );
}
