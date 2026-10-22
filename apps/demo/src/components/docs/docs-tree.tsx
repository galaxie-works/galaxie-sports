'use client';

import { foldSearchText } from '@galaxie/contracts';
import { BookOpen, ChevronRight, ExternalLink, FileCode2, Hash, Link2, Search, Terminal, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, use, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { Endpoint } from '@/components/docs/endpoint';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemActions } from '@/components/ui/item';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DOCS_NAV, type DocGuideRef } from '@/lib/docs';
import { useI18n } from '@/lib/i18n/client';
import type { ClientDictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import type { ApiTagRef } from '@/lib/openapi-reference';
import { cn } from '@/lib/utils';

import { absoluteUrl, copyWithToast } from './copy-to-clipboard';
import { useActiveSection } from './use-active-section';

// ─── dados: guias e tags no idioma da tela (vêm do servidor, pelo layout da documentação) ────────

interface DocsNavData {
  guides: DocGuideRef[];
  tags: ApiTagRef[];
}

const DocsNavContext = createContext<DocsNavData>({ guides: [], tags: [] });

export function DocsNavProvider({ guides, tags, children }: DocsNavData & { children: React.ReactNode }) {
  const value = useMemo(() => ({ guides, tags }), [guides, tags]);
  return <DocsNavContext value={value}>{children}</DocsNavContext>;
}

type Texts = ClientDictionary['docsUi'];

const REFERENCE_HREF = '/docs/referencia';

type Action =
  | { kind: 'link'; href: string }
  | { kind: 'curl'; curl: string }
  | { kind: 'scalar'; url: string };

interface TreeNode {
  key: string;
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Endpoint: o rótulo vira método + rota. */
  method?: string;
  /** Texto (já dobrado) que o filtro procura. */
  search: string;
  actions: Action[];
  children?: TreeNode[];
}

const iconOf = (href: string) => DOCS_NAV.find((d) => d.href === href)?.icon;

function buildTree({ guides: all, tags }: DocsNavData, T: Texts): TreeNode[] {
  const guides = all.filter((d) => d.href !== REFERENCE_HREF);
  const reference = all.find((d) => d.href === REFERENCE_HREF);
  return [
    {
      key: 'guias',
      label: T.guides,
      href: '/docs',
      icon: BookOpen,
      search: foldSearchText(T.guides),
      actions: [],
      children: guides.map((d) => ({
        key: d.href,
        label: d.label,
        href: d.href,
        icon: iconOf(d.href),
        search: foldSearchText(d.label),
        actions: [{ kind: 'link', href: d.href }],
        children: d.sections.map((s) => ({
          key: `${d.href}#${s.id}`,
          label: s.title,
          href: `${d.href}#${s.id}`,
          icon: Hash,
          search: foldSearchText(s.title),
          actions: [{ kind: 'link', href: `${d.href}#${s.id}` }],
        })),
      })),
    },
    {
      key: REFERENCE_HREF,
      label: reference?.label ?? T.reference,
      href: REFERENCE_HREF,
      icon: iconOf(REFERENCE_HREF) ?? FileCode2,
      search: foldSearchText(T.reference),
      actions: [{ kind: 'link', href: REFERENCE_HREF }],
      children: tags.map((t) => ({
        key: `${REFERENCE_HREF}#${t.id}`,
        label: t.name,
        href: `${REFERENCE_HREF}#${t.id}`,
        search: foldSearchText(t.name),
        actions: [{ kind: 'link', href: `${REFERENCE_HREF}#${t.id}` }],
        children: t.operations.map((o) => ({
          key: `${REFERENCE_HREF}#${o.anchor}`,
          label: o.route,
          href: `${REFERENCE_HREF}#${o.anchor}`,
          method: o.method,
          search: foldSearchText(`${o.method} ${o.route} ${o.summary} ${t.name}`),
          actions: [
            { kind: 'curl', curl: o.curl },
            { kind: 'scalar', url: o.scalar },
            { kind: 'link', href: `${REFERENCE_HREF}#${o.anchor}` },
          ],
        })),
      })),
    },
  ];
}

/** Só os nós que casam com o filtro (ou têm descendente que casa); o pai que casa leva os filhos. */
function filterTree(nodes: TreeNode[], term: string): TreeNode[] {
  if (!term) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.search.includes(term)) {
      out.push(n);
      continue;
    }
    const children = filterTree(n.children ?? [], term);
    if (children.length) out.push({ ...n, children });
  }
  return out;
}

// ─── ações ("ações de arquivo" do tree view) ──────────────────────────────────────────────────

function ActionButton({ action, label }: { action: Action; label: string }) {
  const T = useI18n().t.docsUi;
  const copied = { done: T.linkCopied, failed: T.copyFailed };
  const meta = {
    link: { icon: Link2, tip: T.copyLink },
    curl: { icon: Terminal, tip: T.copyCurl },
    scalar: { icon: ExternalLink, tip: T.openScalar },
  }[action.kind];
  const Icon = meta.icon;
  const button =
    action.kind === 'scalar' ? (
      <Button
        variant="ghost"
        size="icon-xs"
        nativeButton={false}
        render={<a href={action.url} target="_blank" rel="noreferrer" />}
        aria-label={fill(T.actionOn, { action: meta.tip, label })}
      >
        <Icon aria-hidden />
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={fill(T.actionOn, { action: meta.tip, label })}
        onClick={() =>
          action.kind === 'curl'
            ? void copyWithToast(action.curl, { ...copied, done: T.curlCopied })
            : void copyWithToast(absoluteUrl(action.href), copied)
        }
      >
        <Icon aria-hidden />
      </Button>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="top">{meta.tip}</TooltipContent>
    </Tooltip>
  );
}

// ─── nós ──────────────────────────────────────────────────────────────────────────────────────

interface TreeState {
  activeKey: string | null;
  /** Chaves do caminho até o nó ativo (os ramos abertos sozinhos). */
  activePath: Set<string>;
  expanded: Set<string>;
  forceOpen: boolean;
  toggle: (key: string, open: boolean) => void;
  onNavigate?: () => void;
}

const indent = (level: number): CSSProperties => ({ paddingLeft: `${level * 12 + 4}px` });

function NodeLabel({ node }: { node: TreeNode }) {
  if (node.method) {
    return (
      <span className="flex min-w-0 flex-1 overflow-hidden [&_code]:text-[0.6875rem]" title={node.label}>
        <Endpoint method={node.method} route={node.label} />
      </span>
    );
  }
  const Icon = node.icon;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {Icon ? (
        <Icon className="text-muted-foreground group-hover/item:text-foreground group-data-[active=true]/item:text-primary size-3.5 shrink-0" />
      ) : null}
      <span className="truncate">{node.label}</span>
    </span>
  );
}

function Row({
  node,
  level,
  state,
  trigger,
}: {
  node: TreeNode;
  level: number;
  state: TreeState;
  trigger?: React.ReactNode;
}) {
  const active = state.activeKey === node.key;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <Item
      render={<div ref={ref} />}
      size="xs"
      data-active={active}
      aria-current={active ? 'location' : undefined}
      className={cn(
        'hover:bg-accent data-[active=true]:bg-primary/10 data-[active=true]:text-foreground relative flex-nowrap gap-1 py-0.5 pr-1',
        // Trilho do ramo ativo, à esquerda.
        'data-[active=true]:before:bg-primary before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full',
        state.activePath.has(node.key) && !active && 'text-foreground',
        !state.activePath.has(node.key) && !active && 'text-muted-foreground',
      )}
      style={indent(level)}
    >
      {trigger ?? <span className="size-5 shrink-0" aria-hidden />}
      <Link
        href={node.href}
        onClick={state.onNavigate}
        className="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center rounded-sm py-1 text-[0.8125rem] outline-none focus-visible:ring-2"
      >
        <NodeLabel node={node} />
      </Link>
      {node.actions.length ? (
        <ItemActions
          // Flutua sobre o fim da linha só quando interessa (hover, foco, nó ativo): o rótulo usa a largura toda.
          className="bg-popover/95 absolute top-1/2 right-1 hidden -translate-y-1/2 gap-0 rounded-md shadow-sm ring-1 ring-white/5 group-focus-within/item:flex group-hover/item:flex group-data-[active=true]/item:flex"
        >
          {node.actions.map((a) => (
            <ActionButton key={a.kind} action={a} label={node.label} />
          ))}
        </ItemActions>
      ) : null}
    </Item>
  );
}

function TreeBranch({ node, level, state }: { node: TreeNode; level: number; state: TreeState }) {
  const T = useI18n().t.docsUi;
  if (!node.children?.length) return <Row node={node} level={level} state={state} />;
  const open = state.forceOpen || state.expanded.has(node.key);
  return (
    <Collapsible open={open} onOpenChange={(next) => state.toggle(node.key, next)}>
      <Row
        node={node}
        level={level}
        state={state}
        trigger={
          <CollapsibleTrigger
            aria-label={fill(T.toggle, { label: node.label })}
            className="hover:bg-muted focus-visible:ring-ring/50 grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm outline-none focus-visible:ring-2"
          >
            <ChevronRight
              aria-hidden
              className="text-muted-foreground size-3 transition-transform in-aria-expanded:rotate-90 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
        }
      />
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="flex flex-col gap-px pt-px">
          {node.children.map((child) => (
            <TreeBranch key={child.key} node={child} level={level + 1} state={state} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── árvore ───────────────────────────────────────────────────────────────────────────────────

/** Caminho atual é dado de URL (runtime): use dentro de `<Suspense>` (ou passe `pathname`). */
export function CurrentDocsTree(props: { onNavigate?: () => void; className?: string }) {
  return <DocsTree pathname={usePathname()} {...props} />;
}

/**
 * Árvore da documentação sobre o tree view da ReUI (`@reui/c-collapsible-10`): guias com as seções e
 * a referência da API por tag do OpenAPI. Mostra a posição atual (página + seção pelo scroll), abre o
 * ramo ativo, filtra por texto e tem ações por nó: copiar link, copiar `curl` e abrir no Scalar.
 */
export function DocsTree({
  pathname,
  onNavigate,
  className,
}: {
  pathname: string | null;
  onNavigate?: () => void;
  className?: string;
}) {
  const T = useI18n().t.docsUi;
  const data = use(DocsNavContext);
  const tree = useMemo(() => buildTree(data, T), [data, T]);
  const [query, setQuery] = useState('');
  const term = foldSearchText(query);
  const visible = useMemo(() => filterTree(tree, term), [tree, term]);

  // Âncoras da página atual, na ordem do documento: seções do guia ou tag + endpoints da referência.
  // Páginas primeiro: o grupo "Guias" também leva a /docs, mas a página é "Começando".
  const page = pathname
    ? [...tree.flatMap((g) => g.children ?? []), ...tree].find((n) => n.href === pathname)
    : null;
  const anchorKeys = useMemo(() => {
    if (!page) return [];
    return page.key === REFERENCE_HREF
      ? (page.children ?? []).flatMap((t) => [t.key, ...(t.children ?? []).map((o) => o.key)])
      : (page.children ?? []).map((s) => s.key);
  }, [page]);
  const anchorIds = useMemo(() => anchorKeys.map((k) => k.split('#')[1] ?? ''), [anchorKeys]);
  const activeAnchor = useActiveSection(anchorIds);

  const activeKey = page ? (activeAnchor ? `${page.href}#${activeAnchor}` : page.key) : null;
  const activePath = useMemo(() => {
    const path = new Set<string>();
    const walk = (nodes: TreeNode[], trail: string[]): boolean => {
      for (const n of nodes) {
        if (n.key === activeKey) {
          [...trail, n.key].forEach((k) => path.add(k));
          return true;
        }
        if (walk(n.children ?? [], [...trail, n.key])) return true;
      }
      return false;
    };
    if (activeKey) walk(tree, []);
    return path;
  }, [tree, activeKey]);

  // Começa com os dois grupos abertos; a cada página, abre o ramo dela (sem fechar o que o usuário abriu).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['guias', REFERENCE_HREF]));
  const pageKey = page?.key ?? null;
  const activeParent = [...activePath].at(-2) ?? null;
  useEffect(() => {
    setExpanded((prev) => {
      const add = [pageKey, activeParent].filter((k): k is string => !!k && !prev.has(k));
      return add.length ? new Set([...prev, ...add]) : prev;
    });
  }, [pageKey, activeParent]);

  const state: TreeState = {
    activeKey,
    activePath,
    expanded,
    forceOpen: !!term,
    toggle: (key, open) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.add(key);
        else next.delete(key);
        return next;
      }),
    onNavigate,
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="p-2">
        <InputGroup className="h-8">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder={T.filter}
            aria-label={T.filter}
            className="text-xs"
          />
          {query ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label={T.clearFilter} onClick={() => setQuery('')}>
                <X aria-hidden />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>
      <nav aria-label={T.treeLabel} className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {visible.length ? (
          <div className="flex flex-col gap-px">
            {visible.map((n) => (
              <TreeBranch key={n.key} node={n} level={0} state={state} />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">{fill(T.noMatch, { query: query.trim() })}</p>
        )}
      </nav>
    </div>
  );
}
