import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { WalletDetail } from '@/components/admin/cosmos/wallet-detail';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { isUuid } from '@/lib/client/tenants';
import { loadStaffWallet } from '@/lib/cosmos/staff-data';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.cosmosStaff.title };
}

type Props = PageProps<'/[locale]/ajustes/carteiras/[tenantId]'>;

async function Detail({ params, searchParams }: Pick<Props, 'params' | 'searchParams'>) {
  await requireAdmin();
  const [{ tenantId }, query, timeZone] = await Promise.all([params, searchParams, getTimeZone()]);
  if (!isUuid(tenantId)) notFound();
  const cursor = typeof query.cursor === 'string' && isUuid(query.cursor) ? query.cursor : undefined;
  const data = await loadStaffWallet(tenantId, cursor);
  if (!data) notFound();
  return <WalletDetail data={data} timeZone={timeZone} />;
}

/** Detalhe de uma carteira da Cosmos para a equipe Galaxie (#1002). */
export default async function WalletPage({ params, searchParams }: Props) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.cosmosStaff.detail.summaryTitle}
        kind="ajustes"
        parents={[{ path: '/ajustes/carteiras', label: t.cosmosStaff.title, kind: 'ajustes' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="wallets">
          <Suspense
            fallback={
              <LoadingStatus>
                <TablePanelSkeleton rows={8} columns={['flex-1', 'w-24', 'w-24', 'w-24']} />
              </LoadingStatus>
            }
          >
            <Detail params={params} searchParams={searchParams} />
          </Suspense>
        </SettingsArea>
      </div>
    </>
  );
}
