import type { Metadata } from 'next';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';

export const metadata: Metadata = { title: 'Painel de operação' };

export default function Page() {
  return (
    <>
      <PageHeader title="Painel de operação" />
      <EmptyState
        title="Painel em construção"
        description="Cota, sincronização e qualidade dos dados entram aqui."
      />
    </>
  );
}
