import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsNav } from '@/components/admin/settings-nav';
import { PageHeader } from '@/components/app-shell/page-header';
import { OpsPanel } from '@/components/ops/ops-panel';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { OpsUnavailableError, readOpsSnapshot } from '@/lib/ops/data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.meta.title };
}

async function Panel() {
  // Sessão de admin (headers) e fuso de quem vê (cookie): fica fora do shell estático.
  await requireAdmin();
  const t = await getT();
  const timeZone = await getTimeZone();
  try {
    const snapshot = await readOpsSnapshot();
    return <OpsPanel snapshot={snapshot} timeZone={timeZone} />;
  } catch (err) {
    if (!(err instanceof OpsUnavailableError)) throw err;
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{t.ops.unavailable.title}</EmptyTitle>
          <EmptyDescription>{t.ops.unavailable.description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
}

export default async function OperationsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.page.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsNav active="operations" />
        <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
          <Panel />
        </Suspense>
      </div>
    </>
  );
}
