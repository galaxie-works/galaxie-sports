import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CrestAdmin } from '@/components/admin/crest-admin';
import { OpsViewPanel } from '@/components/admin/ops-view-page';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { SearchListSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { recentCrestUploads, searchCrests } from '@/lib/crests/server';
import { parseCrestKind } from '@/lib/crests/types';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { logoStorageConfigured } from '@/lib/lineup/store';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.crests.meta.title };
}

type SearchParams = PageProps<'/[locale]/ajustes/escudos'>['searchParams'];

async function Content({ searchParams }: { searchParams: SearchParams }) {
  // sessão de admin (headers) e busca (URL): fora do shell estático
  await requireAdmin();
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.slice(0, 80) : '';
  const kind = parseCrestKind(params.tipo);
  const searching = query.trim().length >= 2;
  const [rows, timeZone] = await Promise.all([
    searching ? searchCrests(query, kind) : recentCrestUploads(),
    getTimeZone(),
  ]);
  return (
    <CrestAdmin
      key={`${query}|${kind}`}
      rows={rows}
      query={query}
      kind={kind}
      searching={searching}
      storageEnabled={logoStorageConfigured()}
      timeZone={timeZone}
    />
  );
}

export default async function CrestAdminPage({ searchParams }: PageProps<'/[locale]/ajustes/escudos'>) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.crests.page.title} kind="ajustes" />
      <div className="flex w-full min-w-0 flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="crests" title={t.crests.page.title} description={t.crests.page.description}>
          <Suspense
            fallback={
              <LoadingStatus>
                <SearchListSkeleton />
              </LoadingStatus>
            }
          >
            <Content searchParams={searchParams} />
          </Suspense>
          {/* o acervo customizado de logos, que estava no Sistema (#1069) */}
          <div id="assets" className="scroll-mt-20">
            <OpsViewPanel view="crests" />
          </div>
        </SettingsArea>
      </div>
    </>
  );
}
