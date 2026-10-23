import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsNav } from '@/components/admin/settings-nav';
import { UsersTable } from '@/components/admin/users-table';
import { PageHeader } from '@/components/app-shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { listDemoUsers } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.admin.meta.users };
}

async function Users() {
  // Fuso de quem vê (cookie): a tabela formata as datas nele, igual no servidor e na hidratação.
  const [{ users, tenants }, timeZone] = await Promise.all([listDemoUsers(), getTimeZone()]);
  return <UsersTable users={users} tenants={tenants} timeZone={timeZone} />;
}

export default async function UsersPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.admin.page.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsNav active="users" />
        {/* Lê a sessão do admin (headers): fica fora do shell estático. */}
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Users />
        </Suspense>
      </div>
    </>
  );
}
