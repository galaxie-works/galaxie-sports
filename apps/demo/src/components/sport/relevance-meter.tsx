import type { Event } from '@galaxie/contracts';
import { Info } from 'lucide-react';

import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { COUNTRIES } from '@/lib/navigation';

/** Nome do mercado na demo (GB = Inglaterra no seletor do Onde assistir). */
function marketName(code: string, t: Dictionary): string {
  const c = COUNTRIES.find((x) => x.code === code || (code === 'GB' && x.code === 'GB-ENG'));
  return c ? t.nav.countries[c.code] : code;
}

function Line({ label, value, detail }: { label: string; value: number; detail?: string | undefined }) {
  return (
    <div className="flex w-full items-baseline justify-between gap-4">
      <span>
        {label}
        {detail ? <span className="opacity-70"> ({detail})</span> : null}
      </span>
      <span className="font-mono tabular-nums">+{value}</span>
    </div>
  );
}

/** Explicação do score: componentes do global e o bônus do mercado. */
function Explanation({ event, t }: { event: Event; t: Dictionary }) {
  const tr = t.event.relevance;
  const b = event.importance_breakdown;
  const r = event.relevance;
  return (
    <div className="flex w-64 flex-col gap-1.5 py-1">
      <span className="font-semibold">{tr.howWeCompute}</span>
      {b ? (
        <div className="flex flex-col gap-0.5">
          <Line label={tr.competition} value={b.tier} />
          <Line label={tr.phase} value={b.phase} detail={event.stage?.leg === 1 ? tr.firstLeg : undefined} />
          {b.derby ? <Line label={tr.derby} value={b.derby} /> : null}
          <Line
            label={tr.decisive}
            value={b.decisive}
            detail={b.flags.length ? b.flags.map((f) => tr.flags[f] ?? f).join(', ') : undefined}
          />
          {b.prestige ? <Line label={tr.prestige} value={b.prestige} /> : null}
          <div className="mt-0.5 flex justify-between border-t border-current/20 pt-0.5 font-semibold">
            <span>{tr.global}</span>
            <span className="font-mono tabular-nums">{event.importance}</span>
          </div>
        </div>
      ) : (
        <span className="opacity-80">{tr.globalSummary}</span>
      )}
      {r ? (
        <div className="flex flex-col gap-0.5">
          <Line
            label={fill(tr.market, { market: r.market })}
            value={r.bonus}
            detail={r.reasons.map((x) => tr.reasons[x] ?? x).join(', ') || tr.noBonus}
          />
          <div className="flex justify-between font-semibold">
            <span>{marketName(r.market, t)}</span>
            <span className="font-mono tabular-nums">{r.score}</span>
          </div>
        </div>
      ) : null}
      <span className="opacity-70">{tr.rules}</span>
    </div>
  );
}

/** "Relevância do jogo": score global e no mercado escolhido, com a explicação no tooltip. */
export async function RelevanceMeter({ event }: { event: Event }) {
  const t = await getT();
  const tr = t.event.relevance;
  const market = event.relevance;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{tr.title}</span>
        <Tooltip>
          <TooltipTrigger
            aria-label={tr.howTo}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2"
          >
            <Info className="size-3.5" aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="left" className="items-start text-left">
            <Explanation event={event} t={t} />
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{tr.global}</span>
          <span className="font-semibold tabular-nums">{event.importance}/100</span>
        </div>
        <Progress value={event.importance} aria-label={tr.globalLabel} />
      </div>
      {market ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {marketName(market.market, t)}
              {market.bonus ? ` (+${market.bonus})` : ''}
            </span>
            <span className="font-semibold tabular-nums">{market.score}/100</span>
          </div>
          <Progress
            value={market.score}
            aria-label={fill(tr.marketLabel, { market: marketName(market.market, t) })}
          />
        </div>
      ) : null}
    </div>
  );
}
