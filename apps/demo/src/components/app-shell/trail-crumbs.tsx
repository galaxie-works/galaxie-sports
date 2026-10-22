'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';

import { MoreHorizontalIcon } from 'lucide-react';

import { BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ancestorsOf,
  applyVisit,
  getTrailServerSnapshot,
  getTrailSnapshot,
  subscribeTrail,
  visitTrail,
  type TrailEntry,
  type TrailKind,
} from '@/lib/trail';
import { cn } from '@/lib/utils';

/** Acima disso, o meio da trilha vira um "…" com menu (fica o início, o item anterior e a página). */
const MAX_VISIBLE_ANCESTORS = 3;

function Crumb({ entry, className }: { entry: TrailEntry; className?: string }) {
  return (
    <>
      <BreadcrumbItem className={cn('min-w-0', className)}>
        <BreadcrumbLink render={<Link href={entry.path} />} className="max-w-40 truncate" title={entry.label}>
          {entry.label}
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator className={className} />
    </>
  );
}

/**
 * Itens da trilha antes da página atual (o título da página é o último item, desenhado pelo
 * PageHeader). Também registra a página na trilha quando ela informa rótulo e tipo; sem rótulo
 * (esqueleto carregando), só mostra o caminho até aqui.
 *
 * A trilha vive no sessionStorage: no servidor e na hidratação não aparece nada (o HTML bate), e os
 * itens surgem logo depois de montar.
 */
export function TrailCrumbs({ label, kind }: { label?: string; kind?: TrailKind }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const path = search ? `${pathname}?${search}` : pathname;
  const trail = useSyncExternalStore(subscribeTrail, getTrailSnapshot, getTrailServerSnapshot);

  useEffect(() => {
    if (label && kind) visitTrail({ path, label, kind });
  }, [path, label, kind]);

  if (!trail) return null;
  // A mesma conta que a visita vai gravar: desenha já o estado final, sem piscar a trilha anterior.
  const ancestors =
    label && kind ? applyVisit(trail, { path, label, kind }).slice(0, -1) : ancestorsOf(trail, path);
  if (!ancestors.length) return null;

  const parent = ancestors.at(-1)!;
  // No celular, só o item anterior e a página atual.
  const desktopOnly = 'hidden md:inline-flex';

  if (ancestors.length <= MAX_VISIBLE_ANCESTORS) {
    return (
      <>
        {ancestors.slice(0, -1).map((e) => (
          <Crumb key={e.path} entry={e} className={desktopOnly} />
        ))}
        <Crumb entry={parent} />
      </>
    );
  }

  const [first, ...rest] = ancestors;
  const middle = rest.slice(0, -1);
  return (
    <>
      <Crumb entry={first!} className={desktopOnly} />
      <BreadcrumbItem className={desktopOnly}>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Mostrar o caminho completo"
            className="hover:text-foreground flex size-5 items-center justify-center rounded-sm transition-colors"
          >
            <MoreHorizontalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto max-w-72">
            {middle.map((e) => (
              <DropdownMenuItem key={e.path} render={<Link href={e.path} />}>
                <span className="truncate">{e.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className={desktopOnly} />
      <Crumb entry={parent} />
    </>
  );
}
