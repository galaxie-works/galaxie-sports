import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsNav } from '@/components/admin/settings-nav';
import { PageHeader } from '@/components/app-shell/page-header';
import { LineupAdminTabs, LineupReview, type ReviewRow } from '@/components/lineup/admin-review';
import { LineupRequests } from '@/components/lineup/admin-requests';
import { LineupTenants } from '@/components/lineup/admin-tenants';
import { Skeleton } from '@/components/ui/skeleton';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { readAllLineups, readRequestQueue, readTenantOperators } from '@/lib/lineup/server';
import {
  flattenLineup,
  matchesFilters,
  parseAdminTab,
  parseLineupFilters,
  parseRequestFilters,
} from '@/lib/lineup/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.lineup.meta.admin };
}

type SearchParams = PageProps<'/[locale]/ajustes/grades'>['searchParams'];

async function Content({ searchParams }: { searchParams: SearchParams }) {
  // Sessão de admin (headers), filtros (URL) e fuso (cookie): fica fora do shell estático.
  await requireAdmin();
  const params = await searchParams;
  const tab = parseAdminTab(params);
  const timeZone = await getTimeZone();
  const queue = await readRequestQueue(tab === 'pedidos' ? parseRequestFilters(params).status : 'open');

  let body: React.ReactNode;
  if (tab === 'revisao') {
    const filters = parseLineupFilters(params);
    const lineups = await readAllLineups();
    const rows: ReviewRow[] = lineups.flatMap((l) => {
      const platform = {
        id: l.platform.id,
        name: l.platform.name,
        country: l.platform.country,
      };
      return flattenLineup(l)
        .filter((item) => matchesFilters(item, platform, filters))
        .map((item) => ({ ...item, platform }));
    });
    body = (
      <LineupReview
        rows={rows}
        filters={filters}
        countries={[...new Set(lineups.map((l) => l.platform.country))].sort()}
        platforms={lineups
          .filter((l) => !filters.country || l.platform.country === filters.country)
          .map((l) => ({ id: l.platform.id, name: l.platform.name }))}
        catalogEmpty={!lineups.length}
        timeZone={timeZone}
      />
    );
  } else if (tab === 'pedidos') {
    body = (
      <LineupRequests
        requests={queue.requests}
        counts={queue.counts}
        status={parseRequestFilters(params).status}
        timeZone={timeZone}
      />
    );
  } else {
    const { rows, platforms } = await readTenantOperators();
    body = <LineupTenants rows={rows} platforms={platforms} />;
  }
  return (
    <>
      <LineupAdminTabs active={tab} open={queue.counts.open} />
      {body}
    </>
  );
}

export default async function LineupAdminPage({ searchParams }: PageProps<'/[locale]/ajustes/grades'>) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.lineup.admin.title} kind="ajustes" />
      {/* Container padrão do app-shell (alinhado à esquerda, largura toda): a tabela da revisão é larga. */}
      <div className="flex w-full min-w-0 flex-col gap-4 p-4 md:p-6">
        <SettingsNav active="lineup" />
        <p className="text-muted-foreground max-w-3xl text-sm">{t.lineup.admin.description}</p>
        <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
          <Content searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
