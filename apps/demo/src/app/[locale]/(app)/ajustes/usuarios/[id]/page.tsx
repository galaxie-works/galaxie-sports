import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { UserDetail } from '@/components/admin/user-detail';
import { PageHeader } from '@/components/app-shell/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { getDemoUser } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.admin.meta.user };
}

async function Detail({ params }: { params: PageProps<'/[locale]/ajustes/usuarios/[id]'>['params'] }) {
  const { id } = await params;
  const [data, timeZone, t] = await Promise.all([getDemoUser(id), getTimeZone(), getT()]);
  if (!data) notFound();
  return (
    <>
      {/* O nome da pessoa vira o item da trilha (em vez do genérico "Usuário"). */}
      <PageHeader title={data.user.name || t.admin.detail.fallbackName} kind="ajustes" />
      <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
        <UserDetail {...data} timeZone={timeZone} />
      </div>
    </>
  );
}

export default function UserPage({ params }: PageProps<'/[locale]/ajustes/usuarios/[id]'>) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
            <Skeleton className="h-96 w-full" />
          </div>
        </>
      }
    >
      <Detail params={params} />
    </Suspense>
  );
}
