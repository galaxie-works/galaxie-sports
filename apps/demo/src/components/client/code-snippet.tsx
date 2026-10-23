'use client';

import { CopyButton } from '@/components/sport/copy-button';
import { cn } from '@/lib/utils';

/** Trecho de código (comando, chave, uso) com botão de copiar. */
export function CodeSnippet({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn('bg-muted/60 relative rounded-lg border', className)}>
      <pre className="overflow-x-auto p-3 pr-10 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {code}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={code} />
      </div>
    </div>
  );
}
