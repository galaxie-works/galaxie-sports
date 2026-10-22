import type { Metadata } from 'next';
import { Suspense } from 'react';

import { UsersTable } from '@/components/admin/users-table';
import { PageHeader } from '@/components/app-shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { listDemoUsers } from '@/lib/auth/admin';

export const metadata: Metadata = { title: 'Usuários' };

async function Users() {
  const users = await listDemoUsers();
  return <UsersTable users={users} />;
}

export default function UsersPage() {
  return (
    <>
      <PageHeader title="Usuários e convites" kind="ajustes" />
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        {/* Lê a sessão do admin (headers): fica fora do shell estático. */}
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Users />
        </Suspense>
      </div>
    </>
  );
}
