'use client';

import { ListTree } from 'lucide-react';
import { Suspense, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useI18n } from '@/lib/i18n/client';

import { CurrentDocsTree, DocsTree } from './docs-tree';

/** No celular e em telas médias, a árvore da documentação abre numa gaveta pelo cabeçalho. */
export function DocsTreeDrawer({ className }: { className?: string }) {
  const T = useI18n().t.docsUi;
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className={className} aria-label={T.openTree}>
            <ListTree aria-hidden />
            <span className="hidden sm:inline">{T.title}</span>
          </Button>
        }
      />
      <SheetContent side="left" className="flex w-[85vw] max-w-80 flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>{T.title}</SheetTitle>
          <SheetDescription className="sr-only">{T.treeLabel}</SheetDescription>
        </SheetHeader>
        <Suspense fallback={<DocsTree pathname={null} onNavigate={close} className="flex-1" />}>
          <CurrentDocsTree onNavigate={close} className="flex-1" />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
