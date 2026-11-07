import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { EditorSkeleton } from '@/components/app-shell/skeletons';
import { BrandThemeEditor } from '@/components/client/brand-theme-editor';
import { ClientArea } from '@/components/client/client-area';
import { Skeleton } from '@/components/ui/skeleton';
import { brandThemeItems } from '@/lib/builder/editor';
import { requireClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.editTheme };
}

type Params = PageProps<'/[locale]/cliente/temas/[id]'>['params'];

async function Editor({ params }: { params: Params }) {
  const [{ id }, t, ctx] = await Promise.all([params, getT(), requireClientContext()]);
  // Tema de outro tenant não existe para quem está vendo.
  const theme =
    isUuid(id) && ctx.tenant ? (await brandThemeItems(ctx.tenant.id)).find((x) => x.id === id) : undefined;
  if (!theme) notFound();
  return (
    <>
      <PageHeader
        title={theme.name}
        kind="cliente"
        parents={[
          { path: '/cliente', label: t.client.title, kind: 'cliente' },
          { path: '/cliente/temas', label: t.client.themes.title, kind: 'cliente' },
        ]}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
        <ClientArea section="themes">
          {() => <BrandThemeEditor key={JSON.stringify(theme)} initial={theme} />}
        </ClientArea>
      </div>
    </>
  );
}

export default function BrandThemePage({ params }: PageProps<'/[locale]/cliente/temas/[id]'>) {
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
