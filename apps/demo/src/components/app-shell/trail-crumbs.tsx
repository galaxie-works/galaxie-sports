'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useSyncExternalStore } from 'react';

import { ArrowLeft, ChevronLeft } from 'lucide-react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  getTrailServerSnapshot,
  getTrailSnapshot,
  originOf,
  subscribeTrail,
  visitTrail,
  type TrailKind,
  type TrailVisit,
} from '@/lib/trail';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * Navegação do cabeçalho, antes do título da página (desenhado pelo PageHeader):
 *
 * - a trilha é a **hierarquia** da página (`parents`: Futebol › Brasileirão Série A › Rodada 32), igual
 *   venha a pessoa de onde vier;
 * - quando ela veio de outro lugar (Ao vivo, busca, país), um "← Voltar para {origem}" leva de volta;
 * - no celular, só "‹ {pai mais próximo}" (ou a origem, numa página sem pais), com o título embaixo.
 *
 * Também registra a página no caminho desta aba (sessionStorage), que dá a origem e a medição de
 * atividade. O caminho só existe no navegador: no servidor e na hidratação a origem não aparece (o HTML
 * bate) e surge logo depois de montar; a hierarquia vem do servidor e aparece desde o início.
 */
export function TrailCrumbs({
  label,
  kind,
  parents: parentsProp,
}: {
  label?: string;
  kind?: TrailKind;
  parents?: TrailVisit[];
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const path = search ? `${pathname}?${search}` : pathname;
  const trail = useSyncExternalStore(subscribeTrail, getTrailSnapshot, getTrailServerSnapshot);
  // Vem do servidor a cada render (array novo): a chave estável evita registrar a visita de novo.
  const parentsKey = JSON.stringify(parentsProp ?? []);
  const parents = useMemo(() => JSON.parse(parentsKey) as TrailVisit[], [parentsKey]);

  useEffect(() => {
    if (label && kind) visitTrail({ path, label, kind }, parents);
  }, [path, label, kind, parents]);

  // Esqueleto carregando (sem rótulo): nada, para não piscar o caminho anterior.
  if (!label || !kind) return null;
  const origin = trail ? originOf(trail, { path, label, kind }, parents) : null;
  const up = parents.at(-1) ?? origin;
  if (!up && !origin) return null;

  return (
    <>
      {up ? (
        <Link
          href={up.path}
          className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-0.5 text-xs md:hidden"
        >
          <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{up.label}</span>
        </Link>
      ) : null}
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        {origin ? (
          <Button
            variant="ghost"
            size="xs"
            nativeButton={false}
            className="text-muted-foreground shrink-0"
            render={<Link href={origin.path} />}
          >
            <ArrowLeft aria-hidden />
            {fill(t.shell.trail.backTo, { label: origin.label })}
          </Button>
        ) : null}
        {parents.length ? (
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              {parents.map((p, i) => (
                <Fragment key={`${i}:${p.path}`}>
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbLink
                      render={<Link href={p.path} />}
                      className="max-w-48 truncate"
                      title={p.label}
                    >
                      {p.label}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
      </div>
    </>
  );
}
