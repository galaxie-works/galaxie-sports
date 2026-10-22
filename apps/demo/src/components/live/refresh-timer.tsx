'use client';

import { Radio, RefreshCw, Satellite } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useNow } from '@/hooks/use-now';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/config';
import { fill, plural } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

import type { LiveRefreshState } from './use-live-refresh';

const secs = (ms: number) => Math.max(0, Math.round(ms / 1000));

type RefreshText = Dictionary['live']['refresh'];

/** Idade legível: segundos, minutos, horas ou dias. */
export function fmtAge(ms: number, locale: Locale, t: RefreshText): string {
  const s = secs(ms);
  if (s < 90) return fill(t.age.seconds, { n: s });
  const min = Math.round(s / 60);
  if (min < 90) return fill(t.age.minutes, { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return fill(t.age.hours, { n: h });
  return plural(locale, Math.round(h / 24), t.age.days);
}

/** Anel de progresso até a próxima atualização agendada. */
function Ring({ progress, active }: { progress: number; active: boolean }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0 -rotate-90" aria-hidden>
      <circle cx="10" cy="10" r={r} className="stroke-muted fill-none" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r={r}
        className={cn(
          'fill-none transition-[stroke-dashoffset] duration-500 ease-linear',
          active ? 'stroke-primary' : 'stroke-muted-foreground',
        )}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
      />
    </svg>
  );
}

/**
 * Cadência visível da página: "Atualizado há 4 s · próxima atualização em 11 s", o anel até a próxima
 * verificação, o mecanismo real (SSE ou polling) e a cadência da fonte (leituras do fornecedor pelo Live
 * Poller, medidas pelo `last_valid_at`).
 */
export function RefreshTimer({
  state,
  sourceLastAt,
  className,
}: {
  state: LiveRefreshState;
  /** Última leitura do fornecedor (o `last_valid_at` mais recente), ISO. */
  sourceLastAt?: string | null;
  className?: string;
}) {
  const { locale, t: dict } = useI18n();
  const t = dict.live.refresh;
  const now = useNow(500);
  const { mechanism, intervalMs, updatedAt, lastSignalAt } = state;
  const mech = t.mechanisms[mechanism];
  const elapsed = now != null && updatedAt ? now - updatedAt : null;
  const remaining = elapsed != null && intervalMs != null ? intervalMs - elapsed : null;
  const sourceAge = now != null && sourceLastAt ? now - Date.parse(sourceLastAt) : null;

  return (
    <div
      className={cn(
        'bg-card text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2 text-xs',
        className,
      )}
      aria-live="off"
    >
      <span className="flex items-center gap-2">
        <Ring
          progress={elapsed != null && intervalMs ? elapsed / intervalMs : 0}
          active={mechanism === 'sse' || mechanism === 'polling'}
        />
        <span className="text-foreground tabular-nums">
          {elapsed == null ? t.updating : fill(t.updatedAgo, { seconds: secs(elapsed) })}
          {remaining != null ? (
            <span className="text-muted-foreground">
              {' · '}
              {remaining > 0 ? fill(t.nextIn, { seconds: secs(remaining) }) : t.updatingNow}
            </span>
          ) : null}
        </span>
      </span>

      <Tooltip>
        <TooltipTrigger render={<span className="flex cursor-help items-center gap-1.5" />}>
          {mechanism === 'sse' ? (
            <Radio className="text-live size-3.5" aria-hidden />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden />
          )}
          {mech.label}
          {mechanism === 'sse' && lastSignalAt && now != null ? (
            <span className="tabular-nums">
              {fill(t.lastSignal, { age: fmtAge(now - lastSignalAt, locale, t) })}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{mech.hint}</TooltipContent>
      </Tooltip>

      {mechanism !== 'static' ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex cursor-help items-center gap-1.5 tabular-nums" />}>
            <Satellite className="size-3.5" aria-hidden />
            {t.source}
            {sourceAge != null && sourceAge >= 0
              ? fill(t.sourceLast, { age: fmtAge(sourceAge, locale, t) })
              : null}
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{t.sourceHint}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
