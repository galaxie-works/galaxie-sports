import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { SettingsArea } from '@/components/admin/settings-nav';
import { ShoppingEntity } from '@/components/admin/shopping-entity';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { FormSkeleton, FramePanelSkeleton, TableSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { getShopEntity, listShopStores } from '@/lib/shop/catalog';
import { isShopEntityRef } from '@/lib/shop/catalog-input';

type Props = PageProps<'/[locale]/ajustes/shopping/[kind]/[id]'>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getT();
  const { kind, id } = await params;
  if (!isShopEntityRef(kind, id)) return { title: t.shopping.meta.title };
  await requireAdmin();
  const detail = await getShopEntity(kind, id).catch(() => null);
  return {
    title: detail ? fill(t.shopping.meta.entityTitle, { name: detail.entity.name }) : t.shopping.meta.title,
  };
}

async function Detail({ params }: Pick<Props, 'params'>) {
  await requireAdmin();
  const { kind, id } = await params;
  if (!isShopEntityRef(kind, id)) notFound();
  const [detail, stores] = await Promise.all([getShopEntity(kind, id), listShopStores()]);
  if (!detail) notFound();
  return <ShoppingEntity detail={detail} stores={stores} />;
}

/** Curadoria de uma entidade no Shopping (#914): ficha, jeito de achar em cada loja e produtos âncora. */
export default async function ShoppingEntityPage({ params }: Props) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.shopping.page.title}
        kind="ajustes"
        parents={[{ path: '/ajustes/shopping', label: t.shopping.page.title, kind: 'ajustes' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="shopping">
          <Suspense
            fallback={
              <LoadingStatus className="flex flex-col gap-4">
                <FramePanelSkeleton>
                  <FormSkeleton fields={3} />
                </FramePanelSkeleton>
                <FramePanelSkeleton>
                  <TableSkeleton rows={6} />
                </FramePanelSkeleton>
              </LoadingStatus>
            }
          >
            <Detail params={params} />
          </Suspense>
        </SettingsArea>
      </div>
    </>
  );
}
