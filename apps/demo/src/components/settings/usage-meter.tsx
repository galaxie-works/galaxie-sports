'use client';

import type { ReactNode } from 'react';

import { Progress, ProgressLabel } from '@/components/ui/progress';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

/** Porcentagem usada, de 0 a 100 (sem limite ou limite zero: nada a medir). */
export function usagePercent(used: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

/**
 * "X de Y", a barra e o % usado. Sem limite (`total` nulo), mostra só o uso e "Sem limite", sem barra.
 * A barra é a `Progress` (role `progressbar`, com o rótulo ligado).
 */
export function UsageMeter({
  label,
  used,
  total,
  className,
}: {
  label: ReactNode;
  used: number;
  total: number | null;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const T = t.settings.usage;
  const n = new Intl.NumberFormat(locale);
  const percent = usagePercent(used, total);
  const summary =
    total === null
      ? `${n.format(used)} · ${T.unlimited}`
      : fill(T.of, { used: n.format(used), total: n.format(total) });

  if (percent === null)
    return (
      <div
        data-slot="usage-meter"
        className={cn('flex flex-wrap items-baseline justify-between gap-2 text-sm', className)}
      >
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{summary}</span>
      </div>
    );

  return (
    <Progress
      data-slot="usage-meter"
      value={Math.min(used, total ?? used)}
      max={total ?? undefined}
      getAriaValueText={() => `${summary} · ${fill(T.percent, { percent: n.format(percent) })}`}
      className={cn('gap-2', className)}
    >
      <div className="flex w-full flex-wrap items-baseline justify-between gap-2 text-sm">
        <ProgressLabel className="font-medium">{label}</ProgressLabel>
        <span className="text-muted-foreground tabular-nums">
          {summary} · {fill(T.percent, { percent: n.format(percent) })}
        </span>
      </div>
    </Progress>
  );
}
