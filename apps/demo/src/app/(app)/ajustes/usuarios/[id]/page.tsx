import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { UserDetail } from '@/components/admin/user-detail';
import { PageHeader } from '@/components/app-shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { getDemoUser } from '@/lib/auth/admin';

export const metadata: Metadata = { title: 'Usuário' };

async function Detail({ params }: { params: PageProps<'/ajustes/usuarios/[id]'>['params'] }) {
  const { id } = await params;
  const data = await getDemoUser(id);
  if (!data) notFound();
  return <UserDetail {...data} />;
}

export default function UserPage({ params }: PageProps<'/ajustes/usuarios/[id]'>) {
  return (
    <>
      <PageHeader title="Usuário" />
      <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Detail params={params} />
        </Suspense>
      </div>
    </>
  );
}
