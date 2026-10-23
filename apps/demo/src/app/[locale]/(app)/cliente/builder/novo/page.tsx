import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { WidgetEditor } from '@/components/client/widget-editor';
import { Skeleton } from '@/components/ui/skeleton';
import { marketsFor } from '@/lib/builder/config';
import { newDraft } from '@/lib/builder/editor';
import { getI18n, getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.newWidget };
}

async function NewWidget({
  searchParams,
}: {
  searchParams: PageProps<'/[locale]/cliente/builder/novo'>['searchParams'];
}) {
  const [{ tipo }, { locale }] = await Promise.all([searchParams, getI18n()]);
  return (
    <ClientArea section="builder">
      {({ tenant }) => (
        <WidgetEditor
          initial={newDraft(typeof tipo === 'string' ? tipo : undefined, tenant, locale)}
          saved={null}
          markets={marketsFor(tenant.markets)}
        />
      )}
    </ClientArea>
  );
}

export default async function NewWidgetPage({ searchParams }: PageProps<'/[locale]/cliente/builder/novo'>) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.editor.newTitle}
        kind="cliente"
        parents={[
          { path: '/cliente', label: t.client.title, kind: 'cliente' },
          { path: '/cliente/builder', label: t.client.builder.title, kind: 'cliente' },
        ]}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-[40rem] w-full" />}>
          <NewWidget searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
