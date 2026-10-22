import type { Metadata } from 'next';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).nav.multisport };
}

export default async function Page() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.nav.multisport} kind="esporte" />
      <EmptyState title={t.shell.empty.underConstruction} description={t.nav.multisportPage.description} />
    </>
  );
}
