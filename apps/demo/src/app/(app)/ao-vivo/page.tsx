import type { Metadata } from 'next';

import { PageHeader } from '@/components/app-shell/page-header';
import { LiveBoard } from '@/components/live/live-board';
import { liveEventsRequest } from '@/lib/galaxie/api';

export const metadata: Metadata = { title: 'Ao vivo' };

/** Tudo que está em andamento agora. Os dados vêm do navegador (pelo proxy) e se atualizam sozinhos. */
export default function LivePage() {
  return (
    <>
      <PageHeader title="Ao vivo" kind="ao vivo" />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <LiveBoard api={liveEventsRequest()} />
      </div>
    </>
  );
}
