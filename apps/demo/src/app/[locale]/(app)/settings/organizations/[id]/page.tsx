import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { OrganizationDetail } from '@/components/admin/organizations/organization-detail';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { requireStaff } from '@/lib/auth/admin';
import { listOrganizationMembers } from '@/lib/client/members';
import { getOrganization } from '@/lib/client/organizations';
import { listStaffActions } from '@/lib/client/staff';
import { isUuid } from '@/lib/client/tenants';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.organizations };
}

/** Tipado à mão: a rota é nova e os tipos gerados do Next só a conhecem depois do build. */
type Props = { params: Promise<{ id: string }> };

async function Detail({ params }: Pick<Props, 'params'>) {
  await requireStaff();
  const [{ id }, timeZone] = await Promise.all([params, getTimeZone()]);
  if (!isUuid(id)) notFound();
  const organization = await getOrganization(id);
  if (!organization) notFound();
  const [members, actions] = await Promise.all([listOrganizationMembers(id), listStaffActions(id)]);
  return (
    <OrganizationDetail organization={organization} members={members} actions={actions} timeZone={timeZone} />
  );
}

/** Uma organização em Ajustes: ficha, marcas, Donos e Financeiro, edição com motivo e as ações da equipe. */
export default async function OrganizationPage({ params }: Props) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.platformStaff.detail.title}
        kind="ajustes"
        parents={[{ path: '/settings/organizations', label: t.ops.nav.organizations, kind: 'ajustes' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="organizations">
          <Suspense
            fallback={
              <LoadingStatus>
                <TablePanelSkeleton rows={6} columns={['flex-1', 'w-24', 'w-24', 'w-24']} />
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
