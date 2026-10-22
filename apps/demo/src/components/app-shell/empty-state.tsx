import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { getT } from '@/lib/i18n/server';

/** Ilustração do exemplo ReUI c-empty-15 (cartões empilhados). */
function StackedCardsIllustration() {
  return (
    <div className="relative h-24 w-52" aria-hidden="true">
      <div className="bg-muted/30 border-border/50 absolute inset-x-6 top-0 h-6 rounded-t-lg border" />
      <div className="bg-muted/50 border-border/60 absolute inset-x-3 top-3 h-6 rounded-t-lg border" />
      <div className="bg-background border-border absolute inset-x-0 top-6 flex h-16 items-center gap-3 rounded-lg border px-4 shadow-sm">
        <div className="bg-muted size-8 shrink-0 rounded" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="bg-muted h-2.5 w-3/4 rounded" />
          <div className="bg-muted/60 h-2 w-1/2 rounded" />
        </div>
      </div>
      <div className="from-background/0 via-background/60 to-background pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b" />
    </div>
  );
}

export async function EmptyState({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children?: React.ReactNode;
}) {
  const t = (await getT()).shell.empty;
  return (
    <div className="flex items-center justify-center p-4">
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia>
            <StackedCardsIllustration />
          </EmptyMedia>
          <EmptyTitle>{title ?? t.title}</EmptyTitle>
          <EmptyDescription>{description ?? t.description}</EmptyDescription>
        </EmptyHeader>
        {children}
      </Empty>
    </div>
  );
}
