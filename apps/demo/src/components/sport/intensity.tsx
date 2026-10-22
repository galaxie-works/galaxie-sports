import { Flame } from 'lucide-react';

import { getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

/** Intensidade da rivalidade (1–5) em chamas. */
export async function Intensity({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  if (!value) return null;
  const label = fill((await getT()).sport.intensity, { value });
  return (
    <span className={cn('flex items-center gap-0.5', className)} title={label}>
      {Array.from({ length: 5 }, (_, i) => (
        <Flame
          key={i}
          aria-hidden
          className={cn('size-3.5', i < value ? 'text-warning' : 'text-muted-foreground/30')}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}
