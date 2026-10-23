import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { WidgetEditor } from '@/components/client/widget-editor';
import { Skeleton } from '@/components/ui/skeleton';
import { marketsFor } from '@/lib/builder/config';
import { draftOf } from '@/lib/builder/editor';
import { builderDb, getWidget } from '@/lib/builder/store';
import { requireClientContext } from '@/lib/client/session';
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
          {async ({ tenant }) => (
            <WidgetEditor
              key={`${widget.id}:${widget.version}`}
              initial={await draftOf(widget, locale)}
              saved={{ id: widget.id, version: widget.version }}
              markets={marketsFor(tenant.markets)}
            />
          )}
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
          <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
            <Skeleton className="h-[40rem] w-full" />
          </div>
        </>
      }
    >
      <Editor params={params} />
    </Suspense>
  );
}
