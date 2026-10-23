import { Suspense } from 'react';

import { ApiCodeButton } from '@/components/docs/api-code-button';
import { HeaderSearchButton } from '@/components/search/search-button';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import type { ApiRequest } from '@/lib/galaxie/request';
import { pathnameOf, type TrailKind, type TrailVisit } from '@/lib/trail';

import { SectionMarker } from './section-marker';
import { TrailCrumbs } from './trail-crumbs';

/**
 * Cabeçalho das páginas: a trilha de navegação (o caminho que o usuário percorreu nesta aba) e, no
 * fim dela, o título da página. Com `kind`, a página entra na trilha com o rótulo `label` (ou o
 * próprio `title`, quando é texto). Sem `kind` (esqueleto carregando), só mostra a trilha até aqui.
 * Com `api`, mostra à direita o botão "Ver código" da chamada principal da página.
 *
 * `parents` é o lugar da página na hierarquia (esporte → competição → jogo), do mais alto ao mais
 * próximo: vira a trilha quando não há caminho percorrido (link direto, aba nova, troca de idioma) e o
 * primeiro deles acende o item do menu.
 */
export function PageHeader({
  title,
  label,
  kind,
  parents,
  api,
  children,
}: {
  title: React.ReactNode;
  label?: string;
  kind?: TrailKind;
  parents?: TrailVisit[];
  api?: ApiRequest;
  children?: React.ReactNode;
}) {
  const crumbLabel = label ?? (typeof title === 'string' ? title : undefined);
  const section = parents?.[0];
  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
      {section ? <SectionMarker href={pathnameOf(section.path)} /> : null}
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-vertical:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {/* Caminho e query string são dados de URL: atrás de Suspense para não bloquear o prerender. */}
          <Suspense fallback={null}>
            <TrailCrumbs label={kind ? crumbLabel : undefined} kind={kind} parents={parents} />
          </Suspense>
          <BreadcrumbItem className="min-w-0">
            {/* O h1 segue sendo o título da página (o ActivityTracker lê `header h1`). */}
            <h1 className="truncate text-sm">
              <BreadcrumbPage className="font-semibold">{title}</BreadcrumbPage>
            </h1>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">
        {children}
        {api ? <ApiCodeButton request={api} labeled /> : null}
        {/* No desktop a busca fica no topo da sidebar (e no ⌘K). */}
        <HeaderSearchButton className="md:hidden" />
      </div>
    </header>
  );
}
