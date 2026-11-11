import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { SponsorsPanel } from '@/components/client/sponsors-panel';
import { listSponsors, MAX_SPONSORS, sponsorReport } from '@/lib/client/sponsors';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.sponsors.meta.title };
}

const REPORT_DAYS = 30;
const day = (d: Date) => d.toISOString().slice(0, 10);

async function Sponsors() {
  const timeZone = await getTimeZone();
  return (
    <ClientArea section="sponsors">
      {async ({ tenant }) => {
        // O tenant vem da sessão (ClientArea): o cliente só vê e muda os patrocinadores dele.
        const now = new Date();
        const [sponsors, report] = await Promise.all([
          listSponsors(tenant.id),
          sponsorReport(tenant.id, day(new Date(now.getTime() - (REPORT_DAYS - 1) * 86_400_000)), day(now)),
        ]);
        return (
          <SponsorsPanel
            sponsors={sponsors}
            report={report}
            max={MAX_SPONSORS}
            now={now.toISOString()}
            timeZone={timeZone}
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientSponsorsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.sponsors.title}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton action rows={3} columns={['flex-1', 'w-32', 'w-24', 'w-16']} />
            </LoadingStatus>
          }
        >
          <Sponsors />
        </Suspense>
      </div>
    </>
  );
}
