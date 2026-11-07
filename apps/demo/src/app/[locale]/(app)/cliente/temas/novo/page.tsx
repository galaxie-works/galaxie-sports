import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { EditorSkeleton } from '@/components/app-shell/skeletons';
import { BrandThemeEditor } from '@/components/client/brand-theme-editor';
import { ClientArea } from '@/components/client/client-area';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.newTheme };
}

export default async function NewBrandThemePage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.meta.newTheme}
        kind="cliente"
        parents={[
          { path: '/cliente', label: t.client.title, kind: 'cliente' },
          { path: '/cliente/temas', label: t.client.themes.title, kind: 'cliente' },
        ]}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
        <Suspense
          fallback={
            <LoadingStatus>
              <EditorSkeleton />
            </LoadingStatus>
          }
        >
          <ClientArea section="themes">{() => <BrandThemeEditor initial={null} />}</ClientArea>
        </Suspense>
      </div>
    </>
  );
}
