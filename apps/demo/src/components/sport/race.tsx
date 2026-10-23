/**
 * Eventos de corrida (F1): o Grande Prêmio é a fase (`stage`) e cada sessão (treino, classificação, sprint,
 * corrida) é um evento com vários participantes no lado `grid`, cada um com `position` e `result`.
 */
import type { Event, Standings, TeamOverview } from '@galaxie/contracts';
import { CalendarClock, MapPin, Timer, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/app-shell/empty-state';
import { Badge } from '@/components/reui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { eventCompetitionHref } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { Crest } from './crest';
import { StatusBadge } from './status-badge';

type Participant = Event['participants'][number];

/** Evento de vários participantes com sessão de corrida (F1). */
export const isRaceEvent = (event: Event) => !!event.session;

/** Classificação final da sessão: só quem tem posição, na ordem. */
export const classified = (event: Event) =>
  event.participants
    .filter((p) => p.side === 'grid' && p.position != null)
    .sort((a, b) => a.position! - b.position!);

/** Título da página do evento: "Bahrain Grand Prix · Corrida". */
export const raceTitle = (event: Event) =>
  [event.stage?.name, event.session?.name].filter(Boolean).join(' · ');

const PODIUM = ['bg-amber-400', 'bg-zinc-300', 'bg-orange-400'];

function PodiumStep({ p, place }: { p: Participant; place: number }) {
  return (
    <Link
      href={`/times/${p.id}`}
      className={cn(
        'group/podium flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center',
        place === 1 ? 'sm:order-2' : place === 2 ? 'sm:order-1 sm:pt-6' : 'sm:order-3 sm:pt-10',
      )}
    >
      <div className="relative">
        <Crest src={p.logo} name={p.name} size={place === 1 ? 'xl' : 'lg'} round />
        <span
          className={cn(
            'absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full text-xs font-bold text-black',
            PODIUM[place - 1],
          )}
        >
          {place}
        </span>
      </div>
      <span className="line-clamp-2 text-sm leading-tight font-semibold group-hover/podium:underline">
        {p.name}
      </span>
      {p.result?.team ? (
        <span className="text-muted-foreground flex max-w-full items-center gap-1 truncate text-xs">
          <Crest src={p.result.team.logo} name={p.result.team.name} size="xs" />
          <span className="truncate">{p.result.team.name}</span>
        </span>
      ) : null}
      {p.result?.time ? <span className="font-mono text-xs tabular-nums">{p.result.time}</span> : null}
    </Link>
  );
}

/** Cabeçalho da sessão: GP, sessão, estado, pódio (ou a hora, antes da largada), data, circuito e voltas. */
export function RaceScoreboard({ event, t, f }: { event: Event; t: Dictionary; f: Formatters }) {
  const tx = t.race;
  const podium = classified(event).slice(0, 3);
  const session = event.session;
  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-2 text-sm">
          {event.competition ? (
            <Link
              href={eventCompetitionHref(event)!}
              className="text-foreground flex items-center gap-2 hover:underline"
            >
              <Crest src={event.competition.logo} name={event.competition.name} size="xs" />
              {event.competition.name}
            </Link>
          ) : null}
          {event.stage?.name ? <span>· {event.stage.name}</span> : null}
          <StatusBadge event={event} />
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-2xl font-semibold tracking-tight">{session?.name}</span>
          {session?.laps ? (
            <span className="text-muted-foreground text-sm">
              {session.distance
                ? fill(tx.lapsDistance, { laps: session.laps, distance: session.distance })
                : fill(tx.lapsOnly, { laps: session.laps })}
            </span>
          ) : null}
        </div>
        {podium.length ? (
          <div className="flex items-start justify-center gap-4">
            {podium.map((p, i) => (
              <PodiumStep key={p.id} p={p} place={i + 1} />
            ))}
          </div>
        ) : event.status === 'scheduled' || event.status === 'starting' ? (
          // antes da largada, a hora; sessão encerrada sem resultado sincronizado não mostra nada aqui
          <span className="text-center text-3xl font-semibold tabular-nums">{f.time(event.starts_at)}</span>
        ) : null}
        <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5" aria-hidden />
            {fill(t.event.scoreboard.dateAtTime, {
              date: f.dateLong(event.starts_at),
              time: f.time(event.starts_at),
            })}
          </span>
          {event.venue ? (
            <Link href={`/locais/${event.venue.id}`} className="flex items-center gap-1.5 hover:underline">
              <MapPin className="size-3.5" aria-hidden />
              {event.venue.name}
              {event.venue.city ? `, ${event.venue.city}` : ''}
            </Link>
          ) : null}
          {session?.fastest_lap?.time ? (
            <span className="flex items-center gap-1.5">
              <Timer className="size-3.5 text-violet-500" aria-hidden />
              {tx.fastestLap}:{' '}
              {event.participants.find((p) => p.id === session.fastest_lap?.participant_id)?.name}{' '}
              <span className="font-mono tabular-nums">{session.fastest_lap.time}</span>
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Ganho (ou perda) de posições da largada à chegada. */
function GridDelta({ grid, position }: { grid: number | null; position: number | null }) {
  if (grid == null || position == null || grid === 0 || grid === position) return null;
  const gained = grid - position;
  const Icon = gained > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs',
        gained > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
      )}
    >
      <Icon className="size-3" aria-hidden />
      {Math.abs(gained)}
    </span>
  );
}

/** Tabela da sessão: posição, piloto, equipe, tempo, voltas e, em corrida/sprint, largada e pits. */
export async function RaceClassification({ event }: { event: Event }) {
  const tx = (await getT()).race;
  const rows = event.participants.filter((p) => p.side === 'grid');
  if (!rows.length) return <EmptyState title={tx.noResults} />;
  const race = event.session?.type === 'race' || event.session?.type === 'sprint';
  const fastest = event.session?.fastest_lap?.participant_id;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 text-right">{tx.position}</TableHead>
          <TableHead>{tx.driver}</TableHead>
          <TableHead className="hidden md:table-cell">{tx.team}</TableHead>
          <TableHead className="text-right">{tx.time}</TableHead>
          <TableHead className="hidden text-right sm:table-cell">{tx.laps}</TableHead>
          {race ? (
            <>
              <TableHead className="text-right">
                <abbr title={tx.gridTitle} className="no-underline">
                  {tx.grid}
                </abbr>
              </TableHead>
              <TableHead className="hidden text-right sm:table-cell">
                <abbr title={tx.pitsTitle} className="no-underline">
                  {tx.pits}
                </abbr>
              </TableHead>
            </>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="text-right font-semibold tabular-nums">{p.position ?? '–'}</TableCell>
            <TableCell>
              <Link href={`/times/${p.id}`} className="flex items-center gap-2 font-medium hover:underline">
                <Crest src={p.logo} name={p.name} size="sm" round />
                <span className="truncate">{p.name}</span>
                {p.id === fastest ? (
                  <Badge variant="info-light" radius="full" title={tx.fastestLap}>
                    <Timer aria-hidden />
                  </Badge>
                ) : null}
              </Link>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              {p.result?.team ? (
                p.result.team.id ? (
                  <Link
                    href={`/times/${p.result.team.id}`}
                    className="text-muted-foreground flex items-center gap-2 hover:underline"
                  >
                    <Crest src={p.result.team.logo} name={p.result.team.name} size="xs" />
                    <span className="truncate">{p.result.team.name}</span>
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{p.result.team.name}</span>
                )
              ) : null}
            </TableCell>
            <TableCell className="text-right font-mono text-sm tabular-nums">
              {p.result?.time ?? '–'}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {p.result?.laps ?? '–'}
            </TableCell>
            {race ? (
              <>
                <TableCell className="text-right tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <GridDelta grid={p.result?.grid ?? null} position={p.position ?? null} />
                    {p.result?.grid || '–'}
                  </span>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {p.result?.pits ?? '–'}
                </TableCell>
              </>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type StandingsGroup = Standings['groups'][number];

/** Ordem dos grupos no campeonato da F1: pilotos antes de construtores. */
export const championshipOrder = (groups: StandingsGroup[]) =>
  [...groups].sort((a, b) => (a.name === 'drivers' ? -1 : b.name === 'drivers' ? 1 : 0));

/** Campeonato de pilotos ou de construtores: posição, nome, vitórias (pilotos) e pontos. */
export async function ChampionshipTable({ group }: { group: StandingsGroup }) {
  const tx = (await getT()).race.championship;
  const drivers = group.name === 'drivers';
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 text-right">#</TableHead>
          <TableHead>{drivers ? tx.drivers : tx.constructors}</TableHead>
          {drivers ? (
            <TableHead className="text-right">
              <abbr title={tx.wins} className="no-underline">
                {tx.winsShort}
              </abbr>
            </TableHead>
          ) : null}
          <TableHead className="text-right">
            <abbr title={tx.points} className="no-underline">
              {tx.pointsShort}
            </abbr>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {group.rows.map((r) => (
          <TableRow key={r.participant.id}>
            <TableCell className="text-right tabular-nums">{r.rank}</TableCell>
            <TableCell>
              <Link
                href={`/times/${r.participant.id}`}
                className="flex items-center gap-2 font-medium hover:underline"
              >
                <Crest src={r.participant.logo} name={r.participant.name} size="sm" round={drivers} />
                <span className="truncate">{r.participant.name}</span>
              </Link>
            </TableCell>
            {drivers ? <TableCell className="text-right tabular-nums">{r.won}</TableCell> : null}
            <TableCell className="text-right font-semibold tabular-nums">{r.points}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type TeamStanding = TeamOverview['standings'][number];

/** Posição do piloto ou da equipe no campeonato (F1), na página do participante; nada nos outros esportes. */
export async function ChampionshipCard({ standings }: { standings: TeamStanding[] }) {
  const rows = standings.filter((s) => s.group === 'drivers' || s.group === 'constructors');
  if (!rows.length) return null;
  const tx = (await getT()).race.championship;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <span className="font-semibold">{tx.title}</span>
        {rows.map((s) => (
          <Link
            key={`${s.competition.id}-${s.group}`}
            href={`/competicoes/${s.competition.slug}?temporada=${s.season.year}`}
            className="hover:bg-accent -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors"
          >
            <span className="text-3xl font-bold tabular-nums">{fill(tx.rank!, { rank: s.rank })}</span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {s.competition.name} · {s.season.label}
              </span>
              <span className="text-muted-foreground text-xs">
                {s.group === 'drivers' ? tx.drivers : tx.constructors} · {s.points} {tx.pointsShort}
                {s.group === 'drivers' && s.won ? ` · ${s.won} ${tx.winsShort}` : ''}
              </span>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
