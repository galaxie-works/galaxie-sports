import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FunctionsSection } from '@/components/admin/cosmos/functions-section';
import { PackagesSection } from '@/components/admin/cosmos/packages-section';
import { WalletsTable } from '@/components/admin/cosmos/wallets-table';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { loadStaffWallets } from '@/lib/cosmos/staff-data';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.cosmosStaff.title };
}

async function Wallets() {
  // só a equipe Galaxie (headers): fica fora do shell estático
  await requireAdmin();
  const [timeZone, data] = await Promise.all([getTimeZone(), loadStaffWallets()]);
  return (
    <div className="flex flex-col gap-6">
      <WalletsTable rows={data.rows} timeZone={timeZone} />
      <PackagesSection packages={data.packages} />
      <FunctionsSection functions={data.functions} assistantProviders={data.assistantProviders} />
    </div>
  );
}

/** Ajustes → Clientes → Carteiras da Cosmos (#1002): a visão interna que o cliente não vê. */
export default async function WalletsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.cosmosStaff.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="wallets">
          <Suspense
            fallback={
              <LoadingStatus>
                <TablePanelSkeleton toolbar rows={6} columns={['flex-1', 'w-24', 'w-24', 'w-24']} />
              </LoadingStatus>
            }
          >
            <Wallets />
          </Suspense>
        </SettingsArea>
      </div>
    </>
  );
}
