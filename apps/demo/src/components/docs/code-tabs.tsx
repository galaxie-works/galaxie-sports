'use client';

import { useState, useSyncExternalStore } from 'react';

import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockExpandButton,
  CodeBlockHeader,
  CodeBlockLanguage,
  CodeBlockTitle,
} from '@/components/reui/code-block/code-block';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CodeExample } from '@/lib/galaxie/request';
import { cn } from '@/lib/utils';

// ─── linguagem preferida: a mesma em todos os blocos, lembrada entre visitas ─────────────────────

const STORAGE_KEY = 'galaxie:docs-linguagem';
const listeners = new Set<() => void>();
let preferred: string | null | undefined;

function readPreferred(): string | null {
  if (preferred === undefined) {
    try {
      preferred = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      preferred = null;
    }
  }
  return preferred;
}

function setPreferred(label: string) {
  preferred = label;
  try {
    window.localStorage.setItem(STORAGE_KEY, label);
  } catch {
    // Sem storage: vale só nesta página.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Bloco de código com abas por linguagem (curl, TypeScript, Python…) e botão de copiar, sobre o code
 * block da ReUI (realce com Shiki). A aba escolhida vale para todos os blocos da página.
 */
export function CodeTabs({
  examples,
  title,
  maxLines,
  className,
}: {
  examples: CodeExample[];
  /** Nome do arquivo ou legenda, à direita das abas. */
  title?: string;
  /** Recolhe blocos longos (com botão "Mostrar tudo"). */
  maxLines?: number;
  className?: string;
}) {
  const choice = useSyncExternalStore(subscribe, readPreferred, () => null);
  const [expanded, setExpanded] = useState(false);
  const current = examples.find((e) => e.label === choice) ?? examples[0];
  if (!current) return null;
  const tabbed = examples.length > 1;

  return (
    <Tabs value={current.label} onValueChange={(v) => setPreferred(String(v))} className={cn('gap-0', className)}>
      <CodeBlock code={current.code} language={current.language} maxLines={maxLines}
        expanded={expanded}
        onExpandedChange={setExpanded}
        className="text-xs"
      >
        <CodeBlockHeader className="pl-1.5">
          {tabbed ? (
            <TabsList variant="line" aria-label="Linguagem do exemplo" className="h-8">
              {examples.map((e) => (
                <TabsTrigger key={e.label} value={e.label} className="px-2 text-xs">
                  {e.label}
                </TabsTrigger>
              ))}
            </TabsList>
          ) : (
            <CodeBlockLanguage className="ml-1.5">{current.label}</CodeBlockLanguage>
          )}
          {title ? <CodeBlockTitle className="hidden sm:block">{title}</CodeBlockTitle> : null}
          <CodeBlockCopyButton className="ml-auto" labels={{ copy: 'Copiar código', copied: 'Copiado' }} />
        </CodeBlockHeader>
        {maxLines ? <CodeBlockExpandButton>{expanded ? 'Mostrar menos' : 'Mostrar tudo'}</CodeBlockExpandButton> : null}
      </CodeBlock>
    </Tabs>
  );
}
