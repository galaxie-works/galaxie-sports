import { Suspense } from 'react';

import { ActivityTracker } from '@/components/app-shell/activity-tracker';
import { AppSidebar } from '@/components/app-shell/app-sidebar';
import { SearchProvider } from '@/components/search/search-provider';
import { RelatedPlayerProvider } from '@/components/sport/related-player';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { docGuides } from '@/lib/docs';
import { getT } from '@/lib/i18n/server';
import { apiReferenceTags } from '@/lib/openapi-reference';
import type { ApiOperationSummary } from '@/lib/search/entries';

export default async function AppLayout({ children }: LayoutProps<'/[locale]'>) {
  const t = await getT();
  // Guias e endpoints da referência para a busca (⌘K): montados no servidor, no idioma da tela, só o
  // que a paleta mostra (o OpenAPI não vai ao navegador).
  const operations: ApiOperationSummary[] = apiReferenceTags(t).flatMap((tag) =>
    tag.operations.map(({ method, route, summary, tag: name, anchor }) => ({
      method,
      route,
      summary,
      tag: name,
      anchor,
    })),
  );
  return (
    <SidebarProvider>
      {/* Busca global (⌘K): em todas as páginas do app e da documentação. */}
      <SearchProvider guides={docGuides(t)} operations={operations}>
        <AppSidebar />
        {/* Player de conteúdo relacionado: painel acoplado à direita, irmão do conteúdo (não é modal). */}
        <RelatedPlayerProvider>
          <SidebarInset>{children}</SidebarInset>
        </RelatedPlayerProvider>
      </SearchProvider>
      {/* Caminho atual = dado de URL: fora do shell estático. */}
      <Suspense>
        <ActivityTracker />
      </Suspense>
    </SidebarProvider>
  );
}
