import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsArea } from '@/components/admin/settings-nav';
import { ShoppingConnectors } from '@/components/admin/shopping-connectors';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { FormSkeleton, FramePanelSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { listShopConnectors } from '@/lib/shop/connectors';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t.shopping.connectors.title} · ${t.shopping.meta.title}` };
}

async function Content() {
  await requireAdmin();
  const [stores, timeZone] = await Promise.all([listShopConnectors(), getTimeZone()]);
  return <ShoppingConnectors stores={stores} timeZone={timeZone} />;
}

/** Ajustes → Engajamento → Shopping → Conectores (#916). */
export default async function ShoppingConnectorsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.shopping.connectors.title}
        kind="ajustes"
        parents={[{ path: '/ajustes/shopping', label: t.shopping.page.title, kind: 'ajustes' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="shopping">
          <Suspense
            fallback={
              <LoadingStatus className="flex flex-col gap-4">
                <FramePanelSkeleton>
                  <FormSkeleton fields={4} />
                </FramePanelSkeleton>
                <FramePanelSkeleton>
                  <FormSkeleton fields={4} />
                </FramePanelSkeleton>
              </LoadingStatus>
            }
          >
            <Content />
          </Suspense>
        </SettingsArea>
      </div>
    </>
  );
}
