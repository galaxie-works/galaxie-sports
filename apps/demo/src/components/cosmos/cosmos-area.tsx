'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CosmosTab } from '@/lib/cosmos/data-utils';
import { useI18n } from '@/lib/i18n/client';

/**
 * Abas da área da Cosmos AI no painel do cliente. A aba fica na URL (`?tab=usage`), para o link e o voltar do
 * navegador; Permissões entra com a issue dela (#996).
 */
export function CosmosArea({
  tab,
  overview,
  usage,
  moderation,
}: {
  tab: CosmosTab;
  overview: ReactNode;
  usage: ReactNode;
  moderation: ReactNode;
}) {
  const { t } = useI18n();
  const T = t.cosmos.tabs;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const change = (next: string) => {
    const p = new URLSearchParams(search.toString());
    if (next === 'overview') p.delete('tab');
    else p.set('tab', next);
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  return (
    <Tabs value={tab} onValueChange={(v) => change(String(v))}>
      <TabsList aria-label={T.label}>
        <TabsTrigger value="overview">{T.overview}</TabsTrigger>
        <TabsTrigger value="usage">{T.usage}</TabsTrigger>
        <TabsTrigger value="moderation">{T.moderation}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4">
        {overview}
      </TabsContent>
      <TabsContent value="usage" className="mt-4">
        {usage}
      </TabsContent>
      <TabsContent value="moderation" className="mt-4">
        {moderation}
      </TabsContent>
    </Tabs>
  );
}
