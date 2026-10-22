import type { Event } from '@galaxie/contracts';
import { Info } from 'lucide-react';

import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { COUNTRIES } from '@/lib/navigation';

const FLAG_LABEL: Record<string, string> = {
  title: 'título',
  relegation: 'rebaixamento',
  elimination: 'eliminação',
  qualification: 'vaga',
};

const REASON_LABEL: Record<string, string> = {
  team_from_market: 'time do país',
  domestic_competition: 'competição do país',
  continental_competition: 'competição continental',
};

/** Nome do mercado na demo (GB = Inglaterra no seletor do Onde assistir). */
function marketName(code: string): string {
  const c = COUNTRIES.find((x) => x.code === code || (code === 'GB' && x.code === 'GB-ENG'));
  return c?.label ?? code;
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

/** Explicação do score em pt-BR: componentes do global e o bônus do mercado. */
function Explanation({ event }: { event: Event }) {
  const b = event.importance_breakdown;
  const r = event.relevance;
  return (
    <div className="flex w-64 flex-col gap-1.5 py-1">
      <span className="font-semibold">Como calculamos (0–100)</span>
      {b ? (
        <div className="flex flex-col gap-0.5">
          <Line label="Competição" value={b.tier} />
          <Line label="Fase" value={b.phase} detail={event.stage?.leg === 1 ? 'ida vale 75%' : undefined} />
          {b.derby ? <Line label="Clássico" value={b.derby} /> : null}
          <Line
            label="Decisão"
            value={b.decisive}
            detail={b.flags.length ? b.flags.map((f) => FLAG_LABEL[f] ?? f).join(', ') : undefined}
          />
          {b.prestige ? <Line label="Prestígio internacional" value={b.prestige} /> : null}
          <div className="mt-0.5 flex justify-between border-t border-current/20 pt-0.5 font-semibold">
            <span>Global</span>
            <span className="font-mono tabular-nums">{event.importance}</span>
          </div>
        </div>
      ) : (
        <span className="opacity-80">Score global: competição, fase, clássico e o que está em jogo.</span>
      )}
      {r ? (
        <div className="flex flex-col gap-0.5">
          <Line
            label={`Mercado ${r.market}`}
            value={r.bonus}
            detail={r.reasons.map((x) => REASON_LABEL[x] ?? x).join(', ') || 'sem bônus'}
          />
          <div className="flex justify-between font-semibold">
            <span>{marketName(r.market)}</span>
            <span className="font-mono tabular-nums">{r.score}</span>
          </div>
        </div>
      ) : null}
      <span className="opacity-70">
        Decisão soma até 20 (título 15, rebaixamento 10, eliminação 8, vaga 6). No mercado: +10 se um time é
        do país, +5 se a competição é do país ou do continente (máximo +10).
      </span>
    </div>
  );
}

/** "Relevância do jogo": score global e no mercado escolhido, com a explicação no tooltip. */
export function RelevanceMeter({ event }: { event: Event }) {
  const market = event.relevance;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Relevância do jogo</span>
        <Tooltip>
          <TooltipTrigger
            aria-label="Como a relevância do jogo é calculada"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2"
          >
            <Info className="size-3.5" aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="left" className="items-start text-left">
            <Explanation event={event} />
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Global</span>
          <span className="font-semibold tabular-nums">{event.importance}/100</span>
        </div>
        <Progress value={event.importance} aria-label="Relevância global" />
      </div>
      {market ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {marketName(market.market)}
              {market.bonus ? ` (+${market.bonus})` : ''}
            </span>
            <span className="font-semibold tabular-nums">{market.score}/100</span>
          </div>
          <Progress value={market.score} aria-label={`Relevância em ${marketName(market.market)}`} />
        </div>
      ) : null}
    </div>
  );
}
