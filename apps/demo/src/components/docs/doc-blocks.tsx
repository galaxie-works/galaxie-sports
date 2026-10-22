/**
 * Peças das páginas de documentação (Server Components): layout com cabeçalho, sumário e navegação
 * anterior/próximo, seções com âncora, texto, avisos, tabelas e a linha de um endpoint.
 */
import { ArrowLeft, ArrowRight, Info, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';
import { DocToc, HeadingAnchor } from '@/components/docs/doc-toc';
import { DocsTreeDrawer } from '@/components/docs/docs-tree-drawer';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { docNavByHref, DOCS_NAV, docSections, type DocNavId, type DocSectionRef } from '@/lib/docs';
import { getT } from '@/lib/i18n/server';
import { fill, rich, type RichTags, type Vars } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

/** Título da aba de um guia: "Conceitos · Documentação". */
export async function docMetadata(id: DocNavId): Promise<Metadata> {
  const t = await getT();
  return { title: fill(t.docs.meta.title, { page: t.code.docsNav[id].label }) };
}

/** Link interno dos textos dos guias (tag `<x>…</x>` do dicionário). */
export const docLink = (href: string) =>
  function DocLink(chunk: string) {
    return (
      <Link href={href} className="text-primary hover:underline">
        {chunk}
      </Link>
    );
  };

/**
 * Texto do dicionário com marcação: `<c>` vira código inline, `<b>` negrito; outras tags (links) vêm
 * em `tags`. As variáveis `{x}` servem para trechos com chaves ou valores da página (URL base, IDs).
 */
export function docText(template: string, tags: RichTags = {}, vars: Vars = {}) {
  return rich(template, { c: (chunk) => <C>{chunk}</C>, b: (chunk) => <strong>{chunk}</strong>, ...tags }, vars);
}

async function Pager({ href }: { href: string }) {
  const t = await getT();
  const index = DOCS_NAV.findIndex((d) => d.href === href);
  const prev = DOCS_NAV[index - 1];
  const next = DOCS_NAV[index + 1];
  if (!prev && !next) return null;
  return (
    <nav aria-label={t.docs.pager.label} className="grid grid-cols-2 gap-3 border-t pt-6">
      {prev ? (
        <Link href={prev.href} className="hover:bg-accent flex flex-col gap-1 rounded-lg border p-3 transition-colors">
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <ArrowLeft className="size-3" aria-hidden /> {t.docs.pager.previous}
          </span>
          <span className="text-sm font-medium">{t.code.docsNav[prev.id].label}</span>
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
            {t.docs.pager.next} <ArrowRight className="size-3" aria-hidden />
          </span>
          <span className="text-sm font-medium">{t.code.docsNav[next.id].label}</span>
        </Link>
      ) : null}
    </nav>
  );
}

/** Página de um guia: cabeçalho (entra na trilha como `docs`), título, lead, sumário e navegação no fim. */
export async function DocPage({
  href,
  title,
  lead,
  wide = false,
  toc,
  children,
}: {
  href: string;
  title: string;
  lead: React.ReactNode;
  /** Largura maior (a referência); os guias ficam numa coluna de leitura. */
  wide?: boolean;
  /** Sumário da página; padrão: as seções do guia (`DOC_SECTIONS`). */
  toc?: DocSectionRef[];
  children: React.ReactNode;
}) {
  const t = await getT();
  const nav = docNavByHref(href);
  const label = nav ? t.code.docsNav[nav.id].label : title;
  const sections = toc ?? (nav ? docSections(nav.id, t) : []);
  return (
    <>
      <PageHeader title={label} kind="docs">
        <DocsTreeDrawer className="xl:hidden" />
      </PageHeader>
      <div id="top" className="flex w-full justify-center gap-8 px-4 md:px-8">
        <article
          className={cn('flex w-full min-w-0 flex-col gap-12 py-6 md:py-10', wide ? 'max-w-5xl' : 'max-w-3xl')}
        >
          <header className="flex flex-col gap-3">
            <Badge variant="primary-light" radius="full" className="w-fit">
              {t.docs.badge}
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
            <div className="text-muted-foreground max-w-prose text-base leading-relaxed">{lead}</div>
          </header>
          {children}
          <Pager href={href} />
        </article>
        {/* Sumário só quando sobra espaço ao lado da coluna de leitura (container query da documentação). */}
        {sections.length ? (
          <aside className="hidden w-48 shrink-0 @4xl/docs:block">
            <div className="sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto py-10">
              <DocToc sections={sections} />
            </div>
          </aside>
        ) : null}
      </div>
    </>
  );
}

/** Seção com título âncora (`#id`); o ícone ao lado copia o link. */
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
    <section id={id} className="flex scroll-mt-20 flex-col gap-5 [&>[data-slot=tabs]]:my-1">
      <h2 className="group/anchor flex items-center gap-2 text-xl font-semibold tracking-tight">
        <a href={`#${id}`}>{title}</a>
        <HeadingAnchor id={id} title={title} />
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

export { Endpoint } from './endpoint';
