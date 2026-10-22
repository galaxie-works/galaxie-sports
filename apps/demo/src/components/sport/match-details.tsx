import type { EventLineups, EventStats, EventTimeline } from '@galaxie/contracts';
import { ChevronRight } from 'lucide-react';

import { ApiCodeButton } from '@/components/docs/api-code-button';
import { MatchTimeline } from '@/components/live/match-timeline';
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { hasPitch, LineupBench, LineupPitch, LineupStarters } from '@/components/sport/lineups';
import { MatchStats } from '@/components/sport/match-stats';
import { UrlTabs } from '@/components/sport/url-tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { lineupsRequest, statsRequest, timelineRequest } from '@/lib/galaxie/api';
import type { ApiRequest } from '@/lib/galaxie/request';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { MarksLookup } from '@/lib/lineup-marks';
import {
  activeTab,
  DETAIL_PARAM,
  DETAIL_TABS,
  LINEUP_PARAM,
  LINEUP_TABS,
  type DetailTab,
  type LineupTab,
} from '@/lib/match-details';
import { statRows } from '@/lib/match-stats';

/** Linha do topo de cada aba: o que ela mostra e o "Ver código" da chamada que a alimenta. */
function PanelIntro({ text, api }: { text: string; api: ApiRequest }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <p>{text}</p>
      <ApiCodeButton request={api} />
    </div>
  );
}

/**
 * "Detalhes da partida": frame colapsável (ReUI c-frame-5, aberto por padrão) com as abas Minuto a minuto,
 * Estatísticas e Escalação — esta com as sub-abas Titulares, Reservas e Campo. A aba ativa fica na URL
 * (`?detalhes=escalacao&escalacao=campo`). Aba sem dado não aparece; sem nenhuma, o bloco não aparece.
 * Os painéis ficam montados ao trocar de aba, para o minuto a minuto ao vivo seguir atualizando.
 */
export function MatchDetails({
  eventId,
  timeline,
  stats,
  lineups,
  marks,
  colors,
  query,
  timeZone,
  locale,
  t,
}: {
  eventId: string;
  /** Minuto a minuto, só quando já faz sentido mostrar (jogo começou ou há lance). */
  timeline: EventTimeline | null;
  stats: EventStats | null;
  lineups: EventLineups | null;
  marks: MarksLookup;
  /** Cor de cada time [mandante, visitante] (`versusColors`). */
  colors: [string, string];
  /** `searchParams` da página (aba e sub-aba ativas). */
  query: Record<string, string | string[] | undefined>;
  timeZone: string;
  locale: Locale;
  t: Dictionary;
}) {
  const tx = t.event.details;
  const hasLineups = !!lineups?.available && lineups.lineups.length > 0;
  const hasStats = statRows(stats).length > 0;
  const tabs = new Set<DetailTab>([
    ...(timeline ? (['minuto'] as const) : []),
    ...(hasStats ? (['estatisticas'] as const) : []),
    ...(hasLineups ? (['escalacao'] as const) : []),
  ]);
  const tab = activeTab(query[DETAIL_PARAM], DETAIL_TABS, tabs);
  if (!tab) return null;
  const lineupTabs = new Set<LineupTab>(
    hasLineups
      ? [
          'titulares',
          ...(lineups!.lineups.some((l) => l.substitutes.length) ? (['reservas'] as const) : []),
          ...(hasPitch(lineups!) ? (['campo'] as const) : []),
        ]
      : [],
  );
  const lineupTab = activeTab(query[LINEUP_PARAM], LINEUP_TABS, lineupTabs) ?? 'titulares';
  const labels: Record<DetailTab, string> = {
    minuto: tx.tabs.timeline,
    estatisticas: tx.tabs.stats,
    escalacao: tx.tabs.lineups,
  };
  const lineupLabels: Record<LineupTab, string> = {
    titulares: tx.lineupTabs.starters,
    reservas: tx.lineupTabs.bench,
    campo: tx.lineupTabs.pitch,
  };

  return (
    <Frame className="w-full" stacked>
      <Collapsible defaultOpen className="group/collapsible">
        <CollapsibleTrigger className="w-full text-left" aria-label={tx.toggle}>
          <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <FrameTitle>{tx.title}</FrameTitle>
              <span className="text-muted-foreground text-xs">{tx.description}</span>
            </div>
            <ChevronRight
              className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90"
              aria-hidden
            />
          </FrameHeader>
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          <FramePanel>
            <UrlTabs param={DETAIL_PARAM} value={tab} className="gap-4">
              <TabsList className="max-w-full overflow-x-auto">
                {DETAIL_TABS.filter((x) => tabs.has(x)).map((x) => (
                  <TabsTrigger key={x} value={x}>
                    {labels[x]}
                  </TabsTrigger>
                ))}
              </TabsList>

              {timeline ? (
                <TabsContent value="minuto" keepMounted className="flex flex-col gap-3">
                  <PanelIntro text={t.live.timeline.description} api={timelineRequest(eventId, locale)} />
                  <MatchTimeline initial={timeline} timeZone={timeZone} />
                </TabsContent>
              ) : null}

              {stats && hasStats ? (
                <TabsContent value="estatisticas" keepMounted className="flex flex-col gap-3">
                  <PanelIntro text={t.event.stats.description} api={statsRequest(eventId, locale)} />
                  <MatchStats stats={stats} colors={colors} locale={locale} t={t} />
                </TabsContent>
              ) : null}

              {hasLineups ? (
                <TabsContent value="escalacao" keepMounted className="flex flex-col gap-3">
                  <PanelIntro text={tx.lineupsDescription} api={lineupsRequest(eventId, locale)} />
                  <UrlTabs param={LINEUP_PARAM} value={lineupTab} className="gap-3">
                    <TabsList variant="line">
                      {LINEUP_TABS.filter((x) => lineupTabs.has(x)).map((x) => (
                        <TabsTrigger key={x} value={x}>
                          {lineupLabels[x]}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    <TabsContent value="titulares" keepMounted>
                      <LineupStarters lineups={lineups!} colors={colors} marks={marks} t={t} />
                    </TabsContent>
                    {lineupTabs.has('reservas') ? (
                      <TabsContent value="reservas" keepMounted>
                        <LineupBench lineups={lineups!} colors={colors} marks={marks} t={t} />
                      </TabsContent>
                    ) : null}
                    {lineupTabs.has('campo') ? (
                      <TabsContent value="campo" keepMounted>
                        <LineupPitch lineups={lineups!} colors={colors} marks={marks} t={t} />
                      </TabsContent>
                    ) : null}
                  </UrlTabs>
                </TabsContent>
              ) : null}
            </UrlTabs>
          </FramePanel>
        </CollapsibleContent>
      </Collapsible>
    </Frame>
  );
}
