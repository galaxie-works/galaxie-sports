import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TenantOverviewSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { FirstSessionChecklist } from '@/components/client/first-session-checklist';
import { TenantOverview } from '@/components/client/tenant-overview';
import { CosmosHelpSlot } from '@/components/cosmos/integration-help-slot';
import { loadChecklist } from '@/lib/client/checklist';
import { getI18n, getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.overview };
}

async function Overview() {
  const { locale, t } = await getI18n();
  return (
    <ClientArea section="overview">
      {async (ctx) => {
        // checklist da primeira sessão (F3, decisão 10): só enquanto falta passo, em trial ou active
        const checklist = await loadChecklist(ctx.tenant, t.client.checklist.secretPlaceholder);
        return (
          <div className="flex flex-col gap-4">
            {checklist ? <FirstSessionChecklist checklist={checklist} /> : null}
            <TenantOverview tenant={ctx.tenant} locale={locale} t={t} />
            {/* Cosmos (#1007): relatório de uso do mês */}
            <CosmosHelpSlot ctx={ctx} kind="usage" />
          </div>
        );
      }}
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
        <Suspense
          fallback={
            <LoadingStatus>
              <TenantOverviewSkeleton />
            </LoadingStatus>
          }
        >
          <Overview />
        </Suspense>
      </div>
    </>
  );
}
