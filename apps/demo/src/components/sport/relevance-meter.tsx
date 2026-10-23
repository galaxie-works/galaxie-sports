import type { Event, EventRelevance } from '@galaxie/contracts';
import { Info } from 'lucide-react';

import { RelevanceCountries, type CountryRelevanceRow } from '@/components/sport/relevance-countries';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { relevanceMarket, type Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { COUNTRIES } from '@/lib/navigation';

/** País do mercado na navegação da demo (GB = Inglaterra). */
function marketCountry(code: string) {
  return COUNTRIES.find((x) => x.code === code || (code === 'GB' && x.code === 'GB-ENG'));
}

function marketName(code: string, t: Dictionary): string {
  const c = marketCountry(code);
  return c ? t.nav.countries[c.code] : code;
}

function Line({ label, value, detail }: { label: string; value: number; detail?: string | undefined }) {
  return (
    <div className="flex w-full items-baseline justify-between gap-4">
      <span>
        {label}
        {detail ? <span className="text-muted-foreground"> ({detail})</span> : null}
      </span>
      <span className="font-mono tabular-nums">+{value}</span>
    </div>
  );
}

/** Explicação do score: componentes do global e as regras do bônus de cada país. */
function Explanation({ event, t }: { event: Event; t: Dictionary }) {
  const tr = t.event.relevance;
  const b = event.importance_breakdown;
  return (
    <div className="flex flex-col gap-2 text-xs">
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
          <div className="mt-0.5 flex justify-between border-t pt-0.5 font-semibold">
            <span>{tr.global}</span>
            <span className="font-mono tabular-nums">{event.importance}</span>
          </div>
        </div>
      ) : (
        <span className="text-muted-foreground">{tr.globalSummary}</span>
      )}
      <span className="text-muted-foreground">{tr.rules}</span>
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">{tr.marketRules}</span>
        <Line label={tr.marketTeam} value={10} />
        <Line label={tr.marketCompetition} value={5} />
        <Line label={tr.marketBracket} value={5} />
        <span className="text-muted-foreground">{tr.marketCap}</span>
        <span className="text-muted-foreground">{tr.marketAudience}</span>
      </div>
    </div>
  );
}

/**
 * Motivo no idioma da demo: em pt-BR e es-AR vale o texto da API (já no idioma pedido); em inglês a API
 * responde em espanhol, então o texto sai do dicionário, com o time citado.
 */
function reasonText(d: EventRelevance['details'][number], locale: Locale, t: Dictionary): string {
  if (locale !== 'en') return d.text;
  const template = t.event.relevance.reasons[d.code];
  return template ? fill(template, { team: d.participant?.name ?? '' }) : d.text;
}

function rowsOf(event: Event, locale: Locale, t: Dictionary): CountryRelevanceRow[] {
  const mine = relevanceMarket(locale);
  return (event.relevance_by_market ?? []).map((r) => ({
    market: r.market,
    flag: marketCountry(r.market)?.code ?? r.market,
    name: marketName(r.market, t),
    score: r.score,
    bonus: r.bonus,
    reasons: r.details.map((d) => ({ code: d.code, points: d.points, text: reasonText(d, locale, t) })),
    highlighted: r.market === mine,
    label: fill(t.event.relevance.marketLabel, { market: marketName(r.market, t) }),
  }));
}

/**
 * "Relevância do jogo": score global e a lista de países (`relevance_by_market`), ordenada pela nota, com
 * os motivos de cada bônus. O país do idioma aparece destacado; a explicação fica no popover.
 */
export async function RelevanceMeter({ event }: { event: Event }) {
  const { locale, t } = await getI18n();
  const tr = t.event.relevance;
  const rows = rowsOf(event, locale, t);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{tr.title}</span>
        <Popover>
          <PopoverTrigger
            aria-label={tr.howTo}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2"
          >
            <Info className="size-3.5" aria-hidden />
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-80 max-w-[calc(100vw-2rem)]">
            <Explanation event={event} t={t} />
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{tr.global}</span>
          <span className="font-semibold tabular-nums">{event.importance}/100</span>
        </div>
        <Progress value={event.importance} aria-label={tr.globalLabel} />
      </div>
      {rows.length ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{tr.byCountry}</span>
            <span className="text-muted-foreground text-[11px]">{tr.byCountryHint}</span>
          </div>
          <RelevanceCountries
            rows={rows}
            texts={{
              yourMarket: tr.yourMarket,
              noBonus: tr.noBonus,
              showAll: fill(tr.showAll, { count: rows.length }),
              showLess: tr.showLess,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
