import type { Metadata } from 'next';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';

export const metadata: Metadata = { title: 'Olimpíadas e Pan' };

export default function Page() {
  return (
    <>
      <PageHeader title="Olimpíadas e Pan" kind="esporte" />
      <EmptyState title="Em construção" description="Quadro de medalhas, agenda e atletas por país." />
    </>
  );
}
