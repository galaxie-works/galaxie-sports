import { Suspense } from 'react';

import { ApiCodeButton } from '@/components/docs/api-code-button';
import { HeaderSearchButton } from '@/components/search/search-button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import type { ApiRequest } from '@/lib/galaxie/request';
import { pathnameOf, type TrailKind, type TrailVisit } from '@/lib/trail';

import { SectionMarker } from './section-marker';
import { TrailCrumbs } from './trail-crumbs';

/**
 * Cabeçalho das páginas: a trilha (a hierarquia da página) e, no fim dela, o título. `parents` é o lugar
 * da página na hierarquia (esporte → competição → rodada → jogo), do mais alto ao mais próximo: é a
 * trilha, igual venha a pessoa de onde vier, e o primeiro deles acende o item do menu. Quando ela veio
 * de outro lugar, um "← Voltar para {origem}" leva de volta (ver TrailCrumbs).
 *
 * Com `kind`, a página entra no caminho desta aba com o rótulo `label` (ou o próprio `title`, quando é
 * texto); sem `kind` (esqueleto carregando), nada de trilha. Com `api`, mostra à direita o botão "Ver
 * código" da chamada principal da página. No celular, o "‹ pai" fica numa linha e o título embaixo.
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
    <header className="bg-background/80 sticky top-0 z-10 flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2 backdrop-blur">
      {section ? <SectionMarker href={pathnameOf(section.path)} /> : null}
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-vertical:h-4" />
      <div className="flex min-w-0 flex-col md:flex-row md:items-center md:gap-2">
        {/* Caminho e query string são dados de URL: atrás de Suspense para não bloquear o prerender. */}
        <Suspense fallback={null}>
          <TrailCrumbs label={kind ? crumbLabel : undefined} kind={kind} parents={parents} />
        </Suspense>
        {/* O h1 segue sendo o título da página (o ActivityTracker lê `header h1`). */}
        <h1 aria-current="page" className="truncate text-sm font-semibold">
          {title}
        </h1>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {children}
        {api ? <ApiCodeButton request={api} labeled /> : null}
        {/* No desktop a busca fica no topo da sidebar (e no ⌘K). */}
        <HeaderSearchButton className="md:hidden" />
      </div>
    </header>
  );
}
