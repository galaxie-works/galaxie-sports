/**
 * Hub do campeonato de corrida (F1), no lugar das abas de classificação e jogos: o GP em destaque (o
 * próximo ou o que está rolando; com a temporada corrida, o último), os campeonatos de pilotos e de
 * construtores lado a lado, o calendário da temporada e o espaço do carrossel Legendary.
 */
import type { Event, Standings } from '@galaxie/contracts';
import { CalendarClock, Flag, MapPin, Trophy } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { ApiRequest } from '@/lib/galaxie/request';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { participantHref } from '@/lib/navigation';
import {
  featuredWeekend,
  raceWeekends,
  raceWinner,
  type FeaturedKind,
  type RaceWeekend,
} from '@/lib/race-weekends';
import { sessionLabel } from '@/lib/race-session';
import { cn } from '@/lib/utils';

import { Crest } from './crest';
import { ChampionshipTable } from './race';
import { Section } from './section';
import { StatusBadge } from './status-badge';

type StandingsGroup = Standings['groups'][number];

/**
 * "6–8 de mar." / "Mar 6 – 8" — o fim de semana do GP, no fuso de quem vê. Montado à mão: o `formatRange`
 * do ICU do Node sai "06 – 08 de 03" em es-AR.
 */
function weekendDates(w: RaceWeekend, f: Formatters) {
  const dayMonth = new Intl.DateTimeFormat(f.locale, {
    day: 'numeric',
    month: 'short',
    timeZone: f.timeZone,
  });
  const [start, end] = [new Date(w.start), new Date(w.end)];
  const startParts = dayMonth.formatToParts(start);
  const endParts = dayMonth.formatToParts(end);
  const part = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((p) => p.type === type)?.value;
  if (part(startParts, 'month') !== part(endParts, 'month'))
    return `${dayMonth.format(start)} – ${dayMonth.format(end)}`;
  if (part(startParts, 'day') === part(endParts, 'day')) return dayMonth.format(end);
  // o dia vem antes do mês (pt, es: "6–8 de mar.") ou depois (en: "Mar 6 – 8")
  return endParts[0]?.type === 'day'
    ? `${part(startParts, 'day')}–${dayMonth.format(end)}`
    : `${dayMonth.format(start)} – ${part(endParts, 'day')}`;
}

/** "sex., 6, 08:30" — dia da semana e hora da sessão (o mês já está no cabeçalho do GP). */
const sessionTime = (iso: string, f: Formatters) =>
  new Intl.DateTimeFormat(f.locale, {
    weekday: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: f.timeZone,
  }).format(new Date(iso));

function WinnerChip({ weekend, t }: { weekend: RaceWeekend; t: Dictionary }) {
  const winner = raceWinner(weekend);
  if (!winner) return null;
  return (
    <Link
      href={participantHref(winner, 'driver')}
      className="flex min-w-0 items-center gap-2 text-sm hover:underline"
      title={t.pages.competition.hub.winner}
    >
      <Trophy className="size-3.5 shrink-0 text-amber-500" aria-label={t.pages.competition.hub.winner} />
      <Crest src={winner.photo?.url ?? winner.logo} name={winner.name} size="xs" round />
      <span className="truncate font-medium">{winner.name}</span>
    </Link>
  );
}

/** O GP em destaque: nome, circuito, datas e a programação do fim de semana. */
function FeaturedGrandPrix({
  weekend,
  kind,
  current,
  t,
  f,
}: {
  weekend: RaceWeekend;
  kind: FeaturedKind;
  /** Temporada em andamento: só nela "nenhum GP depois deste" quer dizer alguma coisa. */
  current: boolean;
  t: Dictionary;
  f: Formatters;
}) {
  const th = t.pages.competition.hub;
  const venue = weekend.main.venue;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
              <Flag className="size-3.5" aria-hidden />
              {kind === 'focus' ? '' : `${kind === 'next' ? th.nextGp : th.lastGp} · `}
              {fill(th.round, { round: weekend.round })}
            </span>
            <span className="text-xl font-semibold tracking-tight">{weekend.name}</span>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5">
                <CalendarClock className="size-3.5" aria-hidden />
                {weekendDates(weekend, f)}
              </span>
              {venue ? (
                <Link href={`/locais/${venue.id}`} className="flex items-center gap-1.5 hover:underline">
                  <MapPin className="size-3.5" aria-hidden />
                  {venue.name}
                  {venue.city ? `, ${venue.city}` : ''}
                </Link>
              ) : null}
            </div>
          </div>
          {weekend.state === 'live' ? (
            <Badge variant="destructive">{th.live}</Badge>
          ) : (
            <WinnerChip weekend={weekend} t={t} />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{th.schedule}</span>
          <ul className="divide-y rounded-lg border">
            {weekend.sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/eventos/${s.id}`}
                  className="hover:bg-accent flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors"
                >
                  <span className={cn('truncate', s.session?.type === 'race' && 'font-semibold')}>
                    {sessionLabel(s.session, t.sport) ?? s.stage?.name}
                  </span>
                  <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs tabular-nums">
                    {sessionTime(s.starts_at, f)}
                    {s.status === 'scheduled' ? null : <StatusBadge event={s} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        {kind === 'last' && current ? <p className="text-muted-foreground text-xs">{th.noUpcoming}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Calendário da temporada: uma linha por GP, com o vencedor (corrido) ou a data (por correr). */
function Calendar({ weekends, t, f }: { weekends: RaceWeekend[]; t: Dictionary; f: Formatters }) {
  const th = t.pages.competition.hub;
  return (
    <ol className="divide-y rounded-xl border">
      {weekends.map((w) => (
        <li
          key={w.name}
          className={cn(
            'flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4',
            (w.state === 'next' || w.state === 'live') && 'bg-primary/5',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="text-muted-foreground w-7 shrink-0 text-right text-xs tabular-nums">
              {w.round}
            </span>
            <div className="flex min-w-0 flex-col">
              <Link href={`/eventos/${w.main.id}`} className="truncate text-sm font-medium hover:underline">
                {w.name}
              </Link>
              <span className="text-muted-foreground truncate text-xs">
                {weekendDates(w, f)}
                {w.main.venue?.city ? ` · ${w.main.venue.city}` : ''}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pl-10 sm:pl-0">
            {w.state === 'live' ? <Badge variant="destructive">{th.live}</Badge> : null}
            {w.state === 'next' ? <Badge variant="primary-light">{th.next}</Badge> : null}
            {w.state === 'done' ? <WinnerChip weekend={w} t={t} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Espaço do carrossel "Legendary" (lendas da F1, `GET /v1/sports/formula-1/legends`), feito em outra
 * frente: enquanto ele não chega, nada aparece. O carrossel entra aqui, sem mexer no resto do hub.
 */
function LegendsSlot({ sport }: { sport: string }) {
  if (sport !== 'formula-1') return null;
  return null;
}

export async function RaceHub({
  sport,
  events,
  groups,
  focus,
  current,
  standingsApi,
  eventsApi,
}: {
  sport: string;
  events: Event[];
  /** GP pedido na URL (`?rodada=`), em destaque no lugar do próximo. */
  focus?: string | null;
  /** A temporada mostrada é a atual. */
  current: boolean;
  groups: StandingsGroup[];
  standingsApi?: ApiRequest;
  eventsApi?: ApiRequest;
}) {
  const [{ locale, t }, f] = await Promise.all([getI18n(), getFormatters()]);
  const th = t.pages.competition.hub;
  const weekends = raceWeekends(events);
  const featured = featuredWeekend(weekends, focus);
  return (
    <div className="flex flex-col gap-8">
      {featured ? (
        <FeaturedGrandPrix weekend={featured.weekend} kind={featured.kind} current={current} t={t} f={f} />
      ) : null}

      {groups.length ? (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          {groups.map((g) => (
            <Section
              key={g.name ?? 'geral'}
              title={g.name ? (t.race.championship[g.name] ?? g.name) : t.pages.competition.standings}
              api={standingsApi}
            >
              <ChampionshipTable group={g} />
            </Section>
          ))}
        </div>
      ) : null}

      {weekends.length ? (
        <Section
          title={th.calendar}
          description={plural(locale, weekends.length, th.calendarDescription)}
          api={eventsApi}
        >
          <Calendar weekends={weekends} t={t} f={f} />
        </Section>
      ) : null}

      <LegendsSlot sport={sport} />
    </div>
  );
}
