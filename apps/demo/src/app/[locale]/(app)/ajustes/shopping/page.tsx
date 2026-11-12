import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsArea } from '@/components/admin/settings-nav';
import { ShoppingCatalog } from '@/components/admin/shopping-catalog';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { FramePanelSkeleton, TableSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { getT } from '@/lib/i18n/server';
import { listCuratedEntities, listShopStores, searchShopEntities } from '@/lib/shop/catalog';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.shopping.meta.title };
}

type SearchParams = PageProps<'/[locale]/ajustes/shopping'>['searchParams'];

async function Content({ searchParams }: { searchParams: SearchParams }) {
  // sessão de admin (headers) e busca (URL): fora do shell estático
  await requireAdmin();
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.slice(0, 80) : '';
  const searching = query.trim().length >= 2;
  const [stores, entities] = await Promise.all([
    listShopStores(),
    searching ? searchShopEntities(query) : query.trim() ? Promise.resolve([]) : listCuratedEntities(),
  ]);
  return (
    <ShoppingCatalog key={query} stores={stores} entities={entities} query={query} searching={searching} />
  );
}

/** Ajustes → Engajamento → Shopping (#914): lojas e curadoria dos produtos oficiais por entidade. */
export default async function ShoppingSettingsPage({
  searchParams,
}: PageProps<'/[locale]/ajustes/shopping'>) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.shopping.page.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea
          active="shopping"
          title={t.shopping.page.title}
          description={t.shopping.page.description}
        >
          <Suspense
            fallback={
              <LoadingStatus className="flex flex-col gap-4">
                <FramePanelSkeleton>
                  <TableSkeleton rows={4} />
                </FramePanelSkeleton>
                <FramePanelSkeleton>
                  <TableSkeleton rows={8} />
                </FramePanelSkeleton>
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
