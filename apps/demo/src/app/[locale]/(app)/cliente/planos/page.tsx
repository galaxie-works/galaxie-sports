import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TenantOverviewSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { PlansPanel } from '@/components/client/plans-panel';
import { getI18n, getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.plans };
}

async function Plans() {
  const { t } = await getI18n();
  return <ClientArea section="plans">{({ tenant }) => <PlansPanel tenant={tenant} t={t} />}</ClientArea>;
}

/** Planos e módulos do tenant: a loja de features (plataforma comercial, #1137). */
export default async function ClientPlansPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.client.planStore.title} kind="cliente" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <TenantOverviewSkeleton />
            </LoadingStatus>
          }
        >
          <Plans />
        </Suspense>
      </div>
    </>
  );
}
