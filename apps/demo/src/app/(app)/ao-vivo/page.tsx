import type { Metadata } from 'next';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';

export const metadata: Metadata = { title: 'Ao vivo' };

export default function Page() {
  return (
    <>
      <PageHeader title="Ao vivo" />
      <EmptyState
        title="Nenhum evento ao vivo agora"
        description="Quando uma partida começar, o placar aparece aqui em tempo real."
      />
    </>
  );
}
