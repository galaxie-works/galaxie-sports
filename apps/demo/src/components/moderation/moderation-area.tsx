'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n/client';
import type { ModerationTab } from '@/lib/moderation/queue-utils';

/** Abas da moderação do cliente (#999): a fila de revisão e o histórico de decisões. A aba fica na URL. */
export function ModerationArea({
  tab,
  queue,
  history,
}: {
  tab: ModerationTab;
  queue: ReactNode;
  history: ReactNode;
}) {
  const { t } = useI18n();
  const T = t.moderation.tabs;
  const router = useRouter();
  const pathname = usePathname();
  const change = (next: string) => {
    // os filtros de uma aba não valem na outra
    const p = new URLSearchParams();
    if (next !== 'queue') p.set('tab', next);
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  return (
    <Tabs value={tab} onValueChange={(v) => change(String(v))}>
      <TabsList aria-label={T.label}>
        <TabsTrigger value="queue">{T.queue}</TabsTrigger>
        <TabsTrigger value="history">{T.history}</TabsTrigger>
      </TabsList>
      <TabsContent value="queue" className="mt-4">
        {queue}
      </TabsContent>
      <TabsContent value="history" className="mt-4">
        {history}
      </TabsContent>
    </Tabs>
  );
}
