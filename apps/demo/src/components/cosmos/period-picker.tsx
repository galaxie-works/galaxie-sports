'use client';

import { CalendarIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  DateSelector,
  type DateSelectorI18nConfig,
  type DateSelectorValue,
} from '@/components/reui/date-selector';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { periodFromSelector, selectorFromPeriod } from '@/lib/cosmos/period';
import { useI18n } from '@/lib/i18n/client';

/** Meses e dias da semana no idioma da tela, pelo Intl; o resto dos textos vem do dicionário. */
function useSelectorI18n(): Partial<DateSelectorI18nConfig> {
  const { t, locale } = useI18n();
  const T = t.cosmos.usage;
  return useMemo(() => {
    const month = (style: 'long' | 'short') =>
      Array.from({ length: 12 }, (_, m) =>
        new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(
          new Date(Date.UTC(2026, m, 1)),
        ),
      );
    // 2026-11-01 é domingo
    const weekday = (style: 'long' | 'narrow') =>
      Array.from({ length: 7 }, (_, d) =>
        new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
          new Date(Date.UTC(2026, 10, 1 + d)),
        ),
      );
    return {
      ...T.dateSelector,
      apply: T.apply,
      cancel: T.cancel,
      months: month('long'),
      monthsShort: month('short'),
      weekdays: weekday('long'),
      weekdaysShort: weekday('narrow'),
    };
  }, [T, locale]);
}

/**
 * Período do extrato: o seletor de datas do exemplo ReUI c-date-selector-2 (cópia fiel em
 * `components/examples/c-date-selector-2.tsx`) num popover, com Aplicar e Cancelar. Aplicar devolve
 * `{ from, to }` (AAAA-MM-DD, inclusive) para a URL.
 */
export function PeriodPicker({
  period,
  onApply,
}: {
  period: { from: string; to: string };
  onApply: (period: { from: string; to: string }) => void;
}) {
  const { t, locale } = useI18n();
  const T = t.cosmos.usage;
  const i18n = useSelectorI18n();
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<DateSelectorValue | undefined>(() =>
    selectorFromPeriod(period),
  );
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const displayText = `${fmt.format(new Date(`${period.from}T00:00:00Z`))} – ${fmt.format(new Date(`${period.to}T00:00:00Z`))}`;

  const handleOpenChange = (next: boolean) => {
    if (next) setInternalValue(selectorFromPeriod(period));
    setOpen(next);
  };
  const next = periodFromSelector(internalValue);

  const handleApply = () => {
    if (next) onApply(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="w-full justify-start sm:w-auto" aria-label={T.periodLabel}>
            <CalendarIcon />
            {displayText}
          </Button>
        }
      />
      <PopoverContent className="w-auto gap-3 p-0" align="start" sideOffset={4}>
        <div className="p-3">
          <DateSelector
            value={internalValue}
            onChange={setInternalValue}
            allowRange={true}
            defaultFilterType="between"
            periodTypes={['day', 'month', 'quarter', 'year']}
            label={T.period}
            inputHint={T.periodHint}
            i18n={i18n}
            dayDateFormat={locale === 'en' ? 'MM/dd/yyyy' : 'dd/MM/yyyy'}
            weekStartsOn={locale === 'en' ? 0 : 1}
          />
        </div>
        <Separator className="p-0" />
        <div className="flex justify-end gap-2 p-3 pt-0">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {T.cancel}
          </Button>
          <Button onClick={handleApply} disabled={!next}>
            {T.apply}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
