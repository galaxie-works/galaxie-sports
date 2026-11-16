import type { Metadata } from 'next';
import { Suspense } from 'react';

import { OrganizationsTable } from '@/components/admin/organizations/organizations-table';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { listOrganizations } from '@/lib/client/organizations';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.organizations };
}

async function Organizations() {
  // só a equipe Galaxie (headers): fica fora do shell estático
  await requireAdmin();
  return <OrganizationsTable rows={await listOrganizations()} />;
}

/** Ajustes → Clientes → Organizações e marcas (#1136, F2): quem assina e paga por cada marca. */
export default async function OrganizationsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.nav.organizations} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="organizations">
          <Suspense
            fallback={
              <LoadingStatus>
                <TablePanelSkeleton rows={6} columns={['flex-1', 'w-24', 'w-24', 'w-24']} />
              </LoadingStatus>
            }
          >
            <Organizations />
          </Suspense>
        </SettingsArea>
      </div>
    </>
  );
}
