import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ActivityTracker } from '@/components/app-shell/activity-tracker';
import { AppSidebar } from '@/components/app-shell/app-sidebar';
import { SearchProvider } from '@/components/search/search-provider';
import { RelatedPlayerProvider } from '@/components/sport/related-player';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { docGuides } from '@/lib/docs';
import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';
import { apiReferenceTags } from '@/lib/openapi-reference';
import type { ApiOperationSummary } from '@/lib/search/entries';

/** A área logada fica fora do índice dos buscadores (só as páginas públicas entram). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: LayoutProps<'/[locale]'>) {
  const { locale, t } = await getI18n();
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
    // Textos de todos os componentes do app no navegador (o layout raiz só manda os das páginas públicas).
    <I18nProvider locale={locale} messages={clientDictionary(locale)}>
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
    </I18nProvider>
  );
}
