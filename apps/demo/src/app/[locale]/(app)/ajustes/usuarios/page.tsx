import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsNav } from '@/components/admin/settings-nav';
import { UsersTable } from '@/components/admin/users-table';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { listDemoUsers } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { readOperatorDomains } from '@/lib/lineup/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.admin.meta.users };
}

async function Users() {
  // Fuso de quem vê (cookie): a tabela formata as datas nele, igual no servidor e na hidratação.
  const [{ users, tenants }, timeZone] = await Promise.all([listDemoUsers(), getTimeZone()]);
  const operatorDomains = await readOperatorDomains(tenants.map((x) => x.id));
  return <UsersTable users={users} tenants={tenants} operatorDomains={operatorDomains} timeZone={timeZone} />;
}

export default async function UsersPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.admin.page.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsNav active="users" />
        {/* Lê a sessão do admin (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton action toolbar rows={8} columns={['flex-1', 'w-40', 'w-24', 'w-20']} />
            </LoadingStatus>
          }
        >
          <Users />
        </Suspense>
      </div>
    </>
  );
}
