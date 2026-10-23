/**
 * Cartão de jogo sem dependência do servidor: recebe idioma, textos e formatadores. O `EventCard`
 * (servidor) e a página Ao vivo (navegador) desenham o mesmo cartão.
 */
import type { Event } from '@galaxie/contracts';
import { Calendar, Check, Flame, MapPin } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Card } from '@/components/ui/card';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { fill, localized } from '@/lib/i18n/text';
import { kickoffText } from '@/lib/provisional';
import { cn } from '@/lib/utils';

import { AnimatedIcon } from './animated-sport-icon';
import { Crest } from './crest';

type Participant = Event['participants'][number];

const STARTED = new Set(['live', 'break', 'finished', 'suspended', 'abandoned']);
const LIVE = new Set(['live', 'break']);
const PROBLEM = new Set(['postponed', 'cancelled', 'suspended', 'abandoned']);

type SportText = Dictionary['sport'];

/**
 * Encerrado sem placar: o relógio fechou o jogo pelo horário, mas o resultado ainda não chegou do fornecedor
 * (esportes sem ao vivo recebem o placar no sync do dia seguinte). Mostra "aguardando resultado", nunca "? – ?".
 */
export function awaitingResult(
  event: Pick<Event, 'status'> & { score?: Pick<Event['score'], 'home' | 'away'> },
) {
  return (
    event.status === 'finished' && event.score != null && event.score.home == null && event.score.away == null
  );
}

/** Estado do jogo (minuto ao vivo, encerrado, adiado…). Síncrono: serve ao servidor e ao navegador. */
export function StatusBadgeView({
  event,
  t,
}: {
  event: Pick<Event, 'status' | 'clock'> & { score?: Pick<Event['score'], 'home' | 'away'> };
  t: SportText;
}) {
  const label = t.status[event.status] ?? event.status;
  if (awaitingResult(event)) return <Badge variant="outline">{t.awaitingResult}</Badge>;
  if (LIVE.has(event.status) || event.status === 'starting') {
    const minute = event.clock?.minute;
    return (
      <Badge variant="destructive-light" radius="full">
        <span className="bg-live size-1.5 animate-pulse rounded-full" aria-hidden />
        {minute ? `${minute}'` : label}
      </Badge>
    );
  }
  if (PROBLEM.has(event.status)) return <Badge variant="warning-light">{label}</Badge>;
  if (event.status === 'finished') return <Badge variant="secondary">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

/** Selo do jogo provisório (anunciado, ainda sem o fornecedor), com a explicação no `title`. */
export function ProvisionalBadgeView({ event, t }: { event: Pick<Event, 'provisional'>; t: SportText }) {
  if (!event.provisional) return null;
  return (
    <Badge variant="info-light" radius="full" title={t.provisional.hint}>
      {t.provisional.badge}
    </Badge>
  );
}

/** Linha de participante (eventos que não são "mandante × visitante": F1, MMA em card múltiplo etc.). */
function TeamRow({
  p,
  goals,
  started,
  fighter = false,
}: {
  p: Participant;
  goals: number | null;
  started: boolean;
  /** Lutador (MMA): foto redonda e, sem placar, o vencedor marcado. */
  fighter?: boolean;
}) {
  const lost = p.winner === false;
  return (
    <div className="flex items-center gap-2">
      <Crest src={p.logo} name={p.name} size="xs" round={fighter} />
      <span
        className={cn(
          'flex-1 truncate text-sm',
          lost && 'text-muted-foreground',
          fighter && p.winner && 'font-semibold',
        )}
      >
        {p.name}
      </span>
      {started ? (
        <span
          className={cn('w-5 text-right text-sm font-semibold tabular-nums', lost && 'text-muted-foreground')}
        >
          {goals ??
            (fighter && p.winner ? <Check className="text-success ml-auto size-4" aria-hidden /> : '–')}
        </span>
      ) : null}
    </div>
  );
}

/** Sessão de corrida (F1): nome da sessão e o top 3 com o tempo; antes da largada, só a sessão. */
function RaceRows({ event }: { event: Event }) {
  const top = event.participants
    .filter((p) => p.side === 'grid' && p.position != null)
    .sort((a, b) => a.position! - b.position!)
    .slice(0, 3);
  return (
    <div className="flex flex-col gap-1.5 px-3">
      <span className="text-sm font-semibold">{event.session?.name}</span>
      {top.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <span className="text-muted-foreground w-4 text-right text-xs font-semibold tabular-nums">
            {p.position}
          </span>
          <Crest src={p.logo} name={p.name} size="xs" round />
          <span className="flex-1 truncate text-sm">{p.name}</span>
          {p.result?.time ? (
            <span className="text-muted-foreground font-mono text-xs tabular-nums">{p.result.time}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Um lado do confronto: escudo grande, nome e a tag do torcedor — a primeira `fan_tag` ("Na briga pelo
 * título") ou, sem tag, o grito da torcida ("Avanti, Palestra!"); sem os dois, nada.
 */
function TeamSide({ p, locale }: { p: Participant; locale: Locale }) {
  const lost = p.winner === false;
  const tag = p.fan_tags?.[0];
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <Crest src={p.logo} name={p.name} size="lg" />
      <span
        className={cn('line-clamp-2 text-sm leading-tight font-semibold', lost && 'text-muted-foreground')}
      >
        {p.name}
      </span>
      {tag ? (
        // tags longas ("Luta contra o rebaixamento") quebram em duas linhas em vez de cortar no celular
        <Badge
          variant="primary-light"
          radius="full"
          className="h-auto min-h-5 max-w-full py-0.5 text-center leading-tight whitespace-normal"
        >
          {localized(tag.text, locale)}
        </Badge>
      ) : p.cheer ? (
        <span className="text-muted-foreground line-clamp-1 text-xs italic">“{p.cheer.text}”</span>
      ) : null}
    </div>
  );
}

/**
 * Centro do card: antes do jogo, o "versus" animado (toca no hover/foco do card); com a bola rolando ou
 * encerrado, o placar ocupa o lugar dele — é a informação que importa e não divide espaço com a animação.
 */
function Center({ event, t }: { event: Event; t: SportText }) {
  const { score } = event;
  if (!STARTED.has(event.status)) {
    return (
      <AnimatedIcon name="versus" className="size-12">
        <span className="text-muted-foreground m-auto text-sm font-semibold">{t.versus}</span>
      </AnimatedIcon>
    );
  }
  // sem placar (ao vivo ou encerrado pelo relógio): o fornecedor ainda não confirmou o jogo (nada de "? – ?")
  if ((LIVE.has(event.status) || event.status === 'finished') && score.home == null && score.away == null) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-muted-foreground text-2xl font-bold">– –</span>
        <span className="text-muted-foreground text-[0.65rem] whitespace-nowrap">{t.awaitingScore}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={cn(
          'text-2xl font-bold whitespace-nowrap tabular-nums',
          LIVE.has(event.status) && 'text-primary',
        )}
      >
        {score.home ?? '?'}
        <span className="text-muted-foreground mx-1.5">–</span>
        {score.away ?? '?'}
      </span>
      {score.penalty ? (
        <span className="text-muted-foreground text-[0.65rem] whitespace-nowrap">
          {fill(t.penaltiesShort, { home: score.penalty.home ?? '?', away: score.penalty.away ?? '?' })}
        </span>
      ) : score.aggregate ? (
        <span className="text-muted-foreground text-[0.65rem] whitespace-nowrap">
          {fill(t.aggregateShort, { home: score.aggregate.home ?? '?', away: score.aggregate.away ?? '?' })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Cartão de partida clicável: competição/rodada e estado; escudos grandes lado a lado com o "versus" (ou o
 * placar) no meio e, abaixo de cada um, nome e tag do torcedor; rodapé com data/hora, local e clássico.
 */
export function EventCardView({
  event,
  showCompetition = true,
  locale,
  t,
  f,
}: {
  event: Event;
  showCompetition?: boolean;
  locale: Locale;
  t: SportText;
  f: Formatters;
}) {
  const home = event.participants.find((p) => p.side === 'home');
  const away = event.participants.find((p) => p.side === 'away');
  const started = STARTED.has(event.status);
  const venue = event.venue ? [event.venue.name, event.venue.city].filter(Boolean).join(', ') : null;

  return (
    <Link href={`/eventos/${event.id}`} className="group/event focus-visible:outline-none">
      <Card
        size="sm"
        className="group-hover/event:bg-accent group-focus-visible/event:ring-ring h-full gap-3 transition-colors group-focus-visible/event:ring-2"
      >
        <div className="text-muted-foreground flex items-center gap-2 px-3 text-xs">
          {showCompetition && event.competition ? (
            <>
              <Crest src={event.competition.logo} name={event.competition.name} size="xs" />
              <span className="truncate">{event.competition.nickname ?? event.competition.name}</span>
              {event.stage?.name ? <span aria-hidden>·</span> : null}
            </>
          ) : null}
          {event.stage?.name ? <span className="truncate">{event.stage.name}</span> : null}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <ProvisionalBadgeView event={event} t={t} />
            <StatusBadgeView event={event} t={t} />
          </span>
        </div>

        {event.session ? (
          <RaceRows event={event} />
        ) : home && away ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-3">
            <TeamSide p={home} locale={locale} />
            <div className="flex h-16 items-center justify-center">
              <Center event={event} t={t} />
            </div>
            <TeamSide p={away} locale={locale} />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 px-3">
            {event.participants.map((p) => (
              <TeamRow
                key={p.id}
                p={p}
                goals={p.side === 'home' ? event.score.home : p.side === 'away' ? event.score.away : null}
                started={started}
                fighter={event.sport === 'mma'}
              />
            ))}
          </div>
        )}

        <div className="text-muted-foreground mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 pt-2.5 text-xs">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Calendar className="size-3.5 shrink-0" aria-hidden />
            {kickoffText(event, f, t)}
          </span>
          {venue ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{venue}</span>
            </span>
          ) : null}
          {event.derby ? (
            <Badge variant="warning-light" radius="full" className="ml-auto">
              <Flame aria-hidden />
              {event.derby.name}
            </Badge>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}
