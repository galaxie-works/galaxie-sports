'use client';

import { History, RefreshCw, Timer } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useMemo, useTransition, type ReactNode } from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n/client';
import { createFormatters } from '@/lib/i18n/format';
import { fill } from '@/lib/i18n/text';

export interface SettingsCrumb {
  label: string;
  /** Sem link: o grupo do menu (não é página) ou a própria página. */
  href?: string;
}

/**
 * Topo comum das páginas de Ajustes (#1072): caminho (Ajustes › Produtos › Ao vivo), título, uma frase do que a
 * página controla, "Atualizado 21:42" e "Atualizar" (relê os dados do servidor). Com `job` e `historyHref`, os
 * links do job e do histórico da área, para saber quando a mudança vale sem ir à Agenda.
 */
export function SettingsPageHeader({
  crumbs,
  title,
  description,
  updatedAt,
  timeZone,
  job,
  historyHref,
  actions,
}: {
  /** Do grupo até o item (o "Ajustes" do começo entra sozinho, com link para o Início). */
  crumbs: readonly SettingsCrumb[];
  title: string;
  description?: ReactNode;
  /** Quando os dados da página foram lidos (ISO); sem ele, nem "Atualizado" nem "Atualizar". */
  updatedAt?: string;
  timeZone: string;
  /** Job que aplica os ajustes da página (ex.: `live-run`) e o link dele na Agenda. */
  job?: { name: string; href: string };
  /** Histórico filtrado pela área. */
  historyHref?: string;
  actions?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const T = t.ops.pageChrome;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const f = useMemo(() => createFormatters(locale, timeZone), [locale, timeZone]);
  const path: SettingsCrumb[] = [{ label: T.root, href: '/ajustes' }, ...crumbs];

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Breadcrumb aria-label={T.breadcrumb}>
          <BreadcrumbList>
            {path.map((c, i) => (
              <Fragment key={`${i}-${c.label}`}>
                {i > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {i === path.length - 1 ? (
                    <BreadcrumbPage>{c.label}</BreadcrumbPage>
                  ) : c.href ? (
                    <BreadcrumbLink render={<Link href={c.href} />}>{c.label}</BreadcrumbLink>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        {updatedAt ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {fill(T.updated, { when: f.time(updatedAt) })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => startTransition(() => router.refresh())}
            >
              {pending ? <Spinner /> : <RefreshCw aria-hidden />}
              {T.refresh}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-muted-foreground max-w-3xl text-sm">{description}</p> : null}
        </div>
        {job || historyHref || actions ? (
          <div className="flex flex-wrap items-center gap-2">
            {job ? (
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={job.href} />}>
                <Timer aria-hidden />
                {fill(T.job, { job: job.name })}
              </Button>
            ) : null}
            {historyHref ? (
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={historyHref} />}>
                <History aria-hidden />
                {T.history}
              </Button>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
