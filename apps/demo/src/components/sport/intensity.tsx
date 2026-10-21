import { Flame } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Intensidade da rivalidade (1–5) em chamas. */
export function Intensity({ value, className }: { value: number | null | undefined; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn('flex items-center gap-0.5', className)} title={`Intensidade ${value} de 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Flame
          key={i}
          aria-hidden
          className={cn('size-3.5', i < value ? 'text-warning' : 'text-muted-foreground/30')}
        />
      ))}
      <span className="sr-only">Intensidade {value} de 5</span>
    </span>
  );
}
