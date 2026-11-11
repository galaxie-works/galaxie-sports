import type { Metadata } from 'next';
import { Suspense } from 'react';

import { OpsViewPanel } from '@/components/admin/ops-view-page';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { ToolbarTableSkeleton } from '@/components/app-shell/skeletons';
import { LineupAdminTabs, LineupReview, type ReviewRow } from '@/components/lineup/admin-review';
import { LineupRequests } from '@/components/lineup/admin-requests';
import { LineupTenants } from '@/components/lineup/admin-tenants';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import {
  countOpenLineupRequests,
  readAllLineups,
  readPlanLibrary,
  readRequestQueue,
  readTenantOperators,
} from '@/lib/lineup/server';
import { logoStorageConfigured } from '@/lib/lineup/store';
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

  // os LINEUP_* (#1070): o bloco do painel de Operação, com o mesmo carregamento das outras páginas
  if (tab === 'ajustes') return <OpsViewPanel view="lineup" />;
  if (tab === 'revisao') {
    const filters = parseLineupFilters(params);
    const [lineups, library] = await Promise.all([readAllLineups(), readPlanLibrary()]);
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
    return (
      <LineupReview
        rows={rows}
        filters={filters}
        countries={[...new Set(lineups.map((l) => l.platform.country))].sort()}
        platforms={lineups
          .filter((l) => !filters.country || l.platform.country === filters.country)
          .map((l) => ({ id: l.platform.id, name: l.platform.name }))}
        catalogEmpty={!lineups.length}
        timeZone={timeZone}
        create={{
          platforms: lineups.map((l) => ({
            id: l.platform.id,
            name: l.platform.name,
            country: l.platform.country,
          })),
          plans: lineups.flatMap((l) =>
            l.plans.map((p) => ({ id: p.id, name: p.name, platformId: l.platform.id })),
          ),
          library: library.map((e) => ({ id: e.id, name: e.name, kind: e.kind, countries: e.countries })),
        }}
        storageEnabled={logoStorageConfigured()}
      />
    );
  }
  if (tab === 'pedidos') {
    const status = parseRequestFilters(params).status;
    const queue = await readRequestQueue(status);
    return (
      <LineupRequests requests={queue.requests} counts={queue.counts} status={status} timeZone={timeZone} />
    );
  }
  const { rows, platforms } = await readTenantOperators();
  return <LineupTenants rows={rows} platforms={platforms} />;
}

/** Abas da página na barra do topo (moldura app-shell-14, #1067), com o número de pedidos em aberto. */
async function Tabs({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const [params, open] = await Promise.all([searchParams, countOpenLineupRequests().catch(() => 0)]);
  return <LineupAdminTabs active={parseAdminTab(params)} open={open} />;
}

export default async function LineupAdminPage({ searchParams }: PageProps<'/[locale]/ajustes/grades'>) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.lineup.admin.title} kind="ajustes" />
      {/* Container padrão do app-shell (alinhado à esquerda, largura toda): a tabela da revisão é larga. */}
      <div className="flex w-full min-w-0 flex-col gap-4 p-4 md:p-6">
        <SettingsArea
          active="lineup"
          title={t.lineup.admin.title}
          description={t.lineup.admin.description}
          tabs={
            <Suspense fallback={<div className="h-10 border-b" />}>
              <Tabs searchParams={searchParams} />
            </Suspense>
          }
        >
          <Suspense
            fallback={
              <LoadingStatus>
                <ToolbarTableSkeleton />
              </LoadingStatus>
            }
          >
            <Content searchParams={searchParams} />
          </Suspense>
        </SettingsArea>
      </div>
    </>
  );
}
