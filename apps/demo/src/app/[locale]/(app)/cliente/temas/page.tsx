import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { BrandThemesPanel } from '@/components/client/brand-themes-panel';
import { ClientArea } from '@/components/client/client-area';
import { Skeleton } from '@/components/ui/skeleton';
import { brandThemeItems } from '@/lib/builder/editor';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.themes };
}

async function Themes() {
  return (
    <ClientArea section="themes">
      {async ({ tenant }) => <BrandThemesPanel themes={await brandThemeItems(tenant.id)} />}
    </ClientArea>
  );
}

export default async function ClientThemesPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.themes.title}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Themes />
        </Suspense>
      </div>
    </>
  );
}
