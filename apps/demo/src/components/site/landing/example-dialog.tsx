'use client';

import { Maximize2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EXAMPLE_ESCAPE } from '@/components/example/example-provider';
import { cn } from '@/lib/utils';

/**
 * Janela com uma página do exemplo público (`/exemplo/...`) navegável: o app de verdade, com a cópia
 * gravada dos dados, num iframe. O iframe só carrega quando a janela abre; o link "tela cheia" abre a
 * mesma página numa aba nova.
 */
export function ExampleDialog({
  src,
  title,
  description,
  closeLabel,
  fullScreenLabel,
  triggerClassName,
  children,
}: {
  src: string;
  title: string;
  description: string;
  closeLabel: string;
  fullScreenLabel: string;
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Esc com o foco dentro do iframe: o exemplo avisa por mensagem (mesma origem)
  useEffect(() => {
    if (!open) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data === EXAMPLE_ESCAPE) setOpen(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={triggerClassName}>{children}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(92svh,1000px)] max-w-[calc(100%-1rem)] flex-col gap-3 p-3 sm:max-w-6xl sm:p-4"
      >
        <div className="flex items-start justify-between gap-3 px-1">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base font-semibold tracking-tight">{title}</DialogTitle>
            <DialogDescription className="text-muted-foreground mt-0.5 text-xs sm:text-sm">
              {description}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={src}
              target="_blank"
              rel="noopener"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}
            >
              <Maximize2 className="size-3.5" aria-hidden />
              {fullScreenLabel}
            </a>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={closeLabel} />}>
              <X aria-hidden />
            </DialogClose>
          </div>
        </div>
        <iframe
          src={src}
          title={title}
          className="bg-background min-h-0 w-full flex-1 rounded-lg ring-1 ring-white/10"
        />
      </DialogContent>
    </Dialog>
  );
}
