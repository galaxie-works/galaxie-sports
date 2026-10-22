/**
 * Peças das páginas de documentação (Server Components): layout com cabeçalho e navegação
 * anterior/próximo, seções com âncora, texto, avisos, tabelas e a linha de um endpoint.
 */
import { ArrowLeft, ArrowRight, Info, Link2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DOCS_NAV } from '@/lib/docs';
import { cn } from '@/lib/utils';

function Pager({ href }: { href: string }) {
  const index = DOCS_NAV.findIndex((d) => d.href === href);
  const prev = DOCS_NAV[index - 1];
  const next = DOCS_NAV[index + 1];
  if (!prev && !next) return null;
  return (
    <nav aria-label="Outros guias" className="grid grid-cols-2 gap-3 border-t pt-6">
      {prev ? (
        <Link href={prev.href} className="hover:bg-accent flex flex-col gap-1 rounded-lg border p-3 transition-colors">
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <ArrowLeft className="size-3" aria-hidden /> Anterior
          </span>
          <span className="text-sm font-medium">{prev.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={next.href}
          className="hover:bg-accent flex flex-col items-end gap-1 rounded-lg border p-3 text-right transition-colors"
        >
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            Próximo <ArrowRight className="size-3" aria-hidden />
          </span>
          <span className="text-sm font-medium">{next.label}</span>
        </Link>
      ) : null}
    </nav>
  );
}

/** Página de um guia: cabeçalho (entra na trilha como `docs`), título, lead e navegação no fim. */
export function DocPage({
  href,
  title,
  lead,
  wide = false,
  children,
}: {
  href: string;
  title: string;
  lead: React.ReactNode;
  /** Largura total (a referência); os guias ficam numa coluna de leitura. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const label = DOCS_NAV.find((d) => d.href === href)?.label ?? title;
  return (
    <>
      <PageHeader title={label} kind="docs" />
      <article className={cn('flex w-full flex-col gap-10 p-4 md:p-6', wide ? 'max-w-6xl' : 'max-w-4xl')}>
        <header className="flex flex-col gap-2">
          <Badge variant="primary-light" radius="full" className="w-fit">
            Documentação da API
          </Badge>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <div className="text-muted-foreground text-base leading-relaxed">{lead}</div>
        </header>
        {children}
        <Pager href={href} />
      </article>
    </>
  );
}

/** Seção com título âncora (`#id`). */
export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-4">
      <h2 className="group/anchor flex items-center gap-2 text-lg font-semibold tracking-tight">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
        <Link2
          className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover/anchor:opacity-100"
          aria-hidden
        />
      </h2>
      {children}
    </section>
  );
}

/** Parágrafo de texto corrido. */
export function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-muted-foreground text-sm leading-relaxed', className)}>{children}</p>;
}

/** Código inline. */
export function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.8125rem] break-words">
      {children}
    </code>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function Callout({
  title,
  tone = 'info',
  children,
}: {
  title: string;
  tone?: 'info' | 'warning';
  children: React.ReactNode;
}) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <Alert variant={tone}>
      <Icon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {/* A descrição é um grid: o texto vai num parágrafo só para o inline (código, negrito) não quebrar linha. */}
        <p>{children}</p>
      </AlertDescription>
    </Alert>
  );
}

/** Tabela simples: a primeira coluna em fonte mono (nome de parâmetro, header, código…). */
export function DocTable({
  head,
  rows,
  mono = true,
}: {
  head: string[];
  rows: React.ReactNode[][];
  /** Primeira coluna em fonte mono. */
  mono?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell
                  key={j}
                  className={cn(
                    'align-top text-sm whitespace-normal',
                    j === 0 && mono && 'font-mono text-xs whitespace-nowrap',
                    j > 0 && 'text-muted-foreground',
                  )}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const METHOD_VARIANT = {
  GET: 'success-light',
  POST: 'info-light',
  PUT: 'warning-light',
  PATCH: 'warning-light',
  DELETE: 'destructive-light',
} as const;

/** Método + rota, como na referência. */
export function Endpoint({ method, route }: { method: string; route: string }) {
  const m = method.toUpperCase() as keyof typeof METHOD_VARIANT;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Badge variant={METHOD_VARIANT[m] ?? 'outline'} size="sm" className="font-mono">
        {m}
      </Badge>
      <code className="truncate font-mono text-xs">{route}</code>
    </span>
  );
}
