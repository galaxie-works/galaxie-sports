import { Suspense } from 'react';

import { CurrentDocsTree, DocsNavProvider, DocsTree } from '@/components/docs/docs-tree';
import { docGuides } from '@/lib/docs';
import { getT } from '@/lib/i18n/server';
import { apiReferenceTags } from '@/lib/openapi-reference';

/**
 * Documentação: árvore de navegação à esquerda (fixa no desktop; gaveta pelo cabeçalho em telas
 * menores) e a página à direita. O layout persiste entre as páginas: filtro e ramos abertos ficam.
 * Guias, seções e tags saem do dicionário e do OpenAPI aqui no servidor; o navegador recebe dados simples.
 */
export default async function DocsLayout({ children }: LayoutProps<'/[locale]/docs'>) {
  const t = await getT();
  return (
    <DocsNavProvider guides={docGuides(t)} tags={apiReferenceTags(t)}>
      <div className="flex min-w-0 flex-1">
        <aside
          aria-label={t.docsUi.treeLabel}
          className="bg-sidebar/30 sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r xl:flex 2xl:w-72"
        >
          <div className="flex h-14 shrink-0 items-center border-b px-4 text-sm font-semibold">{t.docsUi.title}</div>
          {/* Página e seção atuais são dados de URL e de scroll: atrás de Suspense para o prerender. */}
          <Suspense fallback={<DocsTree pathname={null} className="min-h-0 flex-1" />}>
            <CurrentDocsTree className="min-h-0 flex-1" />
          </Suspense>
        </aside>
        <div className="@container/docs flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </DocsNavProvider>
  );
}
