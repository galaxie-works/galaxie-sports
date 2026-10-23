import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { TenantOverview } from '@/components/client/tenant-overview';
import { Skeleton } from '@/components/ui/skeleton';
import { getI18n, getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.overview };
}

async function Overview() {
  const { locale, t } = await getI18n();
  return (
    <ClientArea section="overview">
      {({ tenant }) => <TenantOverview tenant={tenant} locale={locale} t={t} />}
    </ClientArea>
  );
}

export default async function ClientOverviewPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.client.title} kind="cliente" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Overview />
        </Suspense>
      </div>
    </>
  );
}
