import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { ShopReportPanel } from '@/components/client/shop-report-panel';
import { shopClientReport, shopReportFilter } from '@/lib/client/shop-report';
import { periodFrom } from '@/lib/cosmos/data-utils';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.shopping.report.title} · ${t.client.title}` };
}

type Params = Awaited<PageProps<'/[locale]/client/shopping'>['searchParams']>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

async function Report({
  searchParams,
}: {
  searchParams: PageProps<'/[locale]/client/shopping'>['searchParams'];
}) {
  const [params, timeZone] = await Promise.all([searchParams as Promise<Params>, getTimeZone()]);
  const period = periodFrom({ from: one(params.from), to: one(params.to) }, new Date(), timeZone);
  const filter = shopReportFilter(period, {
    competition: one(params.competition),
    team: one(params.team),
    store: one(params.store),
  });
  return (
    <ClientArea section="shopping">
      {async ({ tenant }) => (
        // o tenant vem da sessão (ClientArea já exigiu `billing.view` e o módulo shopping)
        <ShopReportPanel
          report={await shopClientReport(tenant.id, filter)}
          period={{ from: period.fromDay, to: period.toDay }}
        />
      )}
    </ClientArea>
  );
}

export default async function ClientShoppingPage({ searchParams }: PageProps<'/[locale]/client/shopping'>) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.shopping.report.title}
        kind="cliente"
        parents={[{ path: '/client', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton rows={6} columns={['flex-1', 'w-16']} />
            </LoadingStatus>
          }
        >
          <Report searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
