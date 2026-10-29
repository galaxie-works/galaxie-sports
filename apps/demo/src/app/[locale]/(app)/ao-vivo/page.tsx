import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { LiveBoard, LiveBoardFallback } from '@/components/live/live-board';
import { liveEventsRequest } from '@/lib/galaxie/api';
import { getI18n, getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).live.nav.label };
}

/**
 * Tudo que está em andamento agora. Os dados vêm do navegador (pelo proxy) e se atualizam sozinhos. Os
 * filtros ficam na URL (dado de runtime): o quadro fica atrás de Suspense para não bloquear o prerender.
 */
export default async function LivePage() {
  const { locale, t } = await getI18n();
  return (
    <>
      <PageHeader title={t.live.nav.label} kind="ao vivo" />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <Suspense fallback={<LiveBoardFallback />}>
          <LiveBoard api={liveEventsRequest(locale)} />
        </Suspense>
      </div>
    </>
  );
}
