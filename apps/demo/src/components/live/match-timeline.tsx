'use client';

import type {
  EventTimeline,
  MatchPeriod,
  PenaltyShootout,
  TimelineIncident,
  TimelineMarker,
  TimelinePerson,
} from '@galaxie/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleDot,
  CircleSlash,
  Flag,
  Goal,
  MonitorPlay,
  Repeat2,
  Sparkles,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Toggle } from '@/components/ui/toggle';
import { fmtTime, initials } from '@/lib/format';
import { fetchTimeline, timelineKey } from '@/lib/galaxie/live';
import { cn } from '@/lib/utils';

import { LiveDot } from './live-nav-item';
import { RefreshTimer } from './refresh-timer';
import { useLiveRefresh } from './use-live-refresh';

// ─── rótulos ─────────────────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<TimelineIncident['kind'], string> = {
  goal: 'Gol',
  own_goal: 'Gol contra',
  penalty_goal: 'Gol de pênalti',
  penalty_missed: 'Pênalti perdido',
  yellow_card: 'Cartão amarelo',
  second_yellow: 'Segundo amarelo',
  red_card: 'Cartão vermelho',
  substitution: 'Substituição',
  var: 'VAR',
  shootout_scored: 'Pênalti convertido',
  shootout_missed: 'Pênalti perdido',
  other: 'Lance',
};

const VAR_LABEL: Record<string, string> = {
  'goal cancelled': 'Gol anulado',
  'goal confirmed': 'Gol confirmado',
  'goal disallowed': 'Gol anulado',
  'goal disallowed - offside': 'Gol anulado por impedimento',
  'goal disallowed - foul': 'Gol anulado por falta',
  'penalty confirmed': 'Pênalti confirmado',
  'penalty cancelled': 'Pênalti anulado',
  'penalty awarded': 'Pênalti marcado',
  'card upgrade': 'Cartão aumentado para vermelho',
  'card reviewed': 'Cartão revisado',
  'red card cancelled': 'Vermelho anulado',
};

const CARD_REASON: Record<string, string> = {
  foul: 'Falta',
  argument: 'Reclamação',
  dissent: 'Reclamação',
  'time wasting': 'Cera',
  handball: 'Mão na bola',
  handling: 'Mão na bola',
  'violent conduct': 'Conduta violenta',
  tripping: 'Rasteira',
  roughing: 'Jogo brusco',
  'persistent fouling': 'Faltas seguidas',
  simulation: 'Simulação',
  'professional foul last man': 'Falta como último homem',
  'professional handball': 'Mão para impedir gol',
  'off the ball foul': 'Falta sem bola',
  'unsportsmanlike conduct': 'Conduta antidesportiva',
  holding: 'Segurou o adversário',
  elbowing: 'Cotovelada',
  'dangerous play': 'Jogo perigoso',
  'delay of game': 'Retardou o jogo',
};

const FLAG_LABEL: Record<TimelineIncident['flags'][number], string> = {
  decisive: 'Decisivo',
  opener: 'Abre o placar',
  equalizer: 'Empata',
  go_ahead: 'Põe na frente',
};

const POSITION: Record<string, string> = { G: 'Goleiro', D: 'Defensor', M: 'Meio-campista', F: 'Atacante' };

const MARKER_LABEL: Record<TimelineMarker['kind'], string> = {
  kickoff: 'Bola rolando',
  halftime: 'Intervalo',
  second_half: 'Começa o 2º tempo',
  end_of_regulation: 'Fim do tempo normal',
  extra_time: 'Começa a prorrogação',
  penalty_shootout: 'Disputa de pênaltis',
  full_time: 'Fim de jogo',
};

const PERIOD_RANK: Record<MatchPeriod, number> = {
  first_half: 1,
  second_half: 2,
  extra_time_first: 3,
  extra_time_second: 4,
  penalty_shootout: 5,
};
const START_MARKERS = new Set<TimelineMarker['kind']>([
  'kickoff',
  'second_half',
  'extra_time',
  'penalty_shootout',
]);

const utcTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });

// ─── itens ───────────────────────────────────────────────────────────────────────────────────────

type Item =
  | { type: 'incident'; key: string; sort: number[]; incident: TimelineIncident }
  | { type: 'marker'; key: string; sort: number[]; marker: TimelineMarker }
  | { type: 'shootout'; key: string; sort: number[]; shootout: PenaltyShootout };

/** Lances e marcos numa linha só, na ordem do jogo (a disputa de pênaltis vira um bloco). */
export function timelineItems(t: EventTimeline): Item[] {
  const items: Item[] = [];
  for (const i of t.incidents) {
    if (i.clock.period === 'penalty_shootout') continue;
    items.push({
      type: 'incident',
      key: `i${i.sequence}`,
      sort: [PERIOD_RANK[i.clock.period ?? 'first_half'], i.minute ?? 0, i.extra ?? 0, 0, i.sequence],
      incident: i,
    });
  }
  for (const m of t.markers) {
    items.push({
      type: 'marker',
      key: `m${m.kind}`,
      sort: [
        m.clock.period ? PERIOD_RANK[m.clock.period] : 0,
        m.clock.minute ?? 0,
        m.clock.extra_minute ?? 0,
        START_MARKERS.has(m.kind) ? -1 : 1,
        0,
      ],
      marker: m,
    });
  }
  if (t.shootout)
    items.push({ type: 'shootout', key: 'shootout', sort: [5, 0, 0, 0, 0], shootout: t.shootout });
  return items.sort((a, b) => {
    for (let k = 0; k < a.sort.length; k++) {
      const d = (a.sort[k] ?? 0) - (b.sort[k] ?? 0);
      if (d) return d;
    }
    return 0;
  });
}

// ─── peças ───────────────────────────────────────────────────────────────────────────────────────

function OccurredAt({ at, source }: { at: string | null; source: TimelineMarker['occurred_at_source'] }) {
  if (!at) return null;
  const d = new Date(at);
  return (
    <time
      dateTime={at}
      title={`${at} (UTC)${source === 'observed' ? ' · observado pela Galaxie' : source === 'clock' ? ' · início do período + relógio de jogo' : ' · informado pelo fornecedor'}`}
      className="text-muted-foreground text-[0.7rem] tabular-nums"
    >
      {fmtTime(at)} · {utcTime.format(d)} UTC
    </time>
  );
}

function PersonLine({
  person,
  prefix,
  icon,
}: {
  person: TimelinePerson | null;
  prefix?: string;
  icon?: React.ReactNode;
}) {
  if (!person) return null;
  const meta = [
    person.number != null ? `#${person.number}` : null,
    person.position ? (POSITION[person.position] ?? person.position) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const name = person.id ? (
    <Link href={`/pessoas/${person.id}`} className="font-medium hover:underline">
      {person.name}
    </Link>
  ) : (
    <span className="font-medium">{person.name}</span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar size="default" className="size-9">
        {person.photo ? <AvatarImage src={person.photo} alt="" /> : null}
        <AvatarFallback className="text-[0.65rem]">{initials(person.name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm">
          {icon}
          {prefix ? <span className="text-muted-foreground">{prefix}</span> : null}
          {name}
        </span>
        {meta ? <span className="text-muted-foreground text-xs">{meta}</span> : null}
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: TimelineIncident['kind'] }) {
  const base = 'flex size-8 shrink-0 items-center justify-center rounded-full border bg-background';
  switch (kind) {
    case 'goal':
    case 'penalty_goal':
    case 'shootout_scored':
      return (
        <span className={cn(base, 'border-success/50 text-success')}>
          <Goal className="size-4" aria-hidden />
        </span>
      );
    case 'own_goal':
      return (
        <span className={cn(base, 'border-warning/50 text-warning')}>
          <Goal className="size-4" aria-hidden />
        </span>
      );
    case 'penalty_missed':
    case 'shootout_missed':
      return (
        <span className={cn(base, 'border-destructive/50 text-destructive')}>
          <CircleSlash className="size-4" aria-hidden />
        </span>
      );
    case 'yellow_card':
      return (
        <span className={base}>
          <span className="h-4 w-3 rounded-[2px] bg-yellow-400" aria-hidden />
        </span>
      );
    case 'second_yellow':
      return (
        <span className={base}>
          <span className="relative h-4 w-3" aria-hidden>
            <span className="absolute -left-0.5 -top-0.5 h-4 w-3 rounded-[2px] bg-yellow-400" />
            <span className="absolute left-0.5 top-0.5 h-4 w-3 rounded-[2px] bg-red-600" />
          </span>
        </span>
      );
    case 'red_card':
      return (
        <span className={base}>
          <span className="h-4 w-3 rounded-[2px] bg-red-600" aria-hidden />
        </span>
      );
    case 'substitution':
      return (
        <span className={cn(base, 'text-info')}>
          <Repeat2 className="size-4" aria-hidden />
        </span>
      );
    case 'var':
      return (
        <span className={cn(base, 'text-primary')}>
          <MonitorPlay className="size-4" aria-hidden />
        </span>
      );
    default:
      return (
        <span className={base}>
          <CircleDot className="size-4" aria-hidden />
        </span>
      );
  }
}

function IncidentRow({ i }: { i: TimelineIncident }) {
  const decisive = i.flags.includes('decisive');
  const title =
    i.kind === 'var'
      ? `VAR · ${VAR_LABEL[(i.detail ?? '').toLowerCase()] ?? i.detail ?? 'revisão'}`
      : KIND_LABEL[i.kind];
  const reason =
    i.kind.endsWith('card') || i.kind === 'second_yellow'
      ? CARD_REASON[(i.comments ?? '').toLowerCase()]
      : null;
  return (
    <li className="relative flex gap-3 pb-4">
      <div className="text-muted-foreground w-12 shrink-0 pt-1.5 text-right text-sm font-semibold tabular-nums">
        {i.clock.display}
      </div>
      <div className="relative flex flex-col items-center">
        <KindIcon kind={i.kind} />
      </div>
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-2 rounded-lg border px-3 py-2.5',
          i.key_moment ? 'border-primary/30 bg-primary/5' : 'bg-card/50',
          decisive && 'border-primary/60 bg-primary/10 ring-primary/30 ring-1',
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('text-sm font-semibold', i.key_moment && 'text-base')}>{title}</span>
          {i.score_after && i.kind !== 'shootout_scored' ? (
            <span className="text-primary text-base font-bold tabular-nums">
              {i.score_after.home}–{i.score_after.away}
            </span>
          ) : null}
          {i.flags.map((f) => (
            <Badge key={f} variant={f === 'decisive' ? 'default' : 'primary-light'} radius="full" size="sm">
              {f === 'decisive' ? <Sparkles aria-hidden /> : null}
              {FLAG_LABEL[f]}
            </Badge>
          ))}
          {reason ? <span className="text-muted-foreground text-xs">{reason}</span> : null}
          {i.team ? (
            <span className="text-muted-foreground ml-auto flex items-center gap-1.5 text-xs">
              <Crest src={i.team.logo} name={i.team.name ?? ''} size="xs" />
              {i.team.name}
            </span>
          ) : null}
        </div>

        {i.kind === 'substitution' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <PersonLine
              person={i.player_in}
              prefix="Entra"
              icon={<ArrowUp className="text-success size-3.5 shrink-0" aria-label="Entra" />}
            />
            <PersonLine
              person={i.player_out}
              prefix="Sai"
              icon={<ArrowDown className="text-destructive size-3.5 shrink-0" aria-label="Sai" />}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <PersonLine person={i.player} />
            {i.assist && i.kind !== 'var' ? <PersonLine person={i.assist} prefix="Assistência" /> : null}
          </div>
        )}
        <OccurredAt at={i.occurred_at} source={i.occurred_at_source} />
      </div>
    </li>
  );
}

function MarkerRow({ m, shootout }: { m: TimelineMarker; shootout: boolean }) {
  const label =
    m.kind === 'full_time' && shootout ? 'Fim de jogo · decidido nos pênaltis' : MARKER_LABEL[m.kind];
  return (
    <li className="flex items-center gap-3 pb-4">
      <div className="text-muted-foreground w-12 shrink-0 text-right text-xs tabular-nums">
        {m.kind === 'kickoff' ? "0'" : m.clock.display}
      </div>
      <div className="flex size-8 shrink-0 items-center justify-center">
        <Flag className="text-muted-foreground size-4" aria-hidden />
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="bg-muted text-foreground rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">
          {label}
        </span>
        <OccurredAt at={m.occurred_at} source={m.occurred_at_source} />
      </div>
    </li>
  );
}

/** Disputa de pênaltis: grade ✓/✗ por time e a lista cobrança a cobrança, com o placar corrido. */
export function ShootoutBlock({ shootout }: { shootout: PenaltyShootout }) {
  const teams = (['home', 'away'] as const).map((side) => ({
    side,
    team: shootout.kicks.find((k) => k.team?.side === side)?.team ?? null,
    kicks: shootout.kicks.filter((k) => k.team?.side === side),
  }));
  const rounds = Math.max(5, ...teams.map((t) => t.kicks.length));
  const first = shootout.first_kicker;
  return (
    <li className="pb-4 sm:pl-[5.75rem]">
      <Card size="sm" className="border-primary/30">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Disputa de pênaltis</span>
              {first ? (
                <span className="text-muted-foreground text-xs">{first.name} bateu primeiro</span>
              ) : null}
            </div>
            <span className="text-2xl font-bold tabular-nums">
              {shootout.score.home}
              <span className="text-muted-foreground mx-1.5">–</span>
              {shootout.score.away}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {teams.map((t) => (
              <div key={t.side} className="flex items-center gap-3">
                <span className="flex w-32 min-w-0 items-center gap-2 text-sm sm:w-40">
                  <Crest src={t.team?.logo ?? null} name={t.team?.name ?? ''} size="xs" />
                  <span className={cn('truncate', shootout.winner_side === t.side && 'font-semibold')}>
                    {t.team?.name ?? (t.side === 'home' ? 'Mandante' : 'Visitante')}
                  </span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: rounds }, (_, r) => {
                    const k = t.kicks[r];
                    if (!k)
                      return (
                        <span
                          key={r}
                          className="border-muted-foreground/40 size-6 rounded-full border border-dashed"
                          aria-label="Sem cobrança"
                        />
                      );
                    return (
                      <span
                        key={r}
                        title={`${k.player?.name ?? ''} — ${k.scored ? 'converteu' : 'perdeu'}`}
                        className={cn(
                          'flex size-6 items-center justify-center rounded-full',
                          k.scored ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive',
                          k.decisive && 'ring-primary ring-2',
                        )}
                      >
                        {k.scored ? (
                          <Check className="size-3.5" aria-label="Converteu" />
                        ) : (
                          <X className="size-3.5" aria-label="Perdeu" />
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <ol className="flex flex-col divide-y rounded-md border">
            {shootout.kicks.map((k) => (
              <li
                key={k.order}
                className={cn('flex items-center gap-3 px-3 py-2 text-sm', k.decisive && 'bg-primary/10')}
              >
                <span className="text-muted-foreground w-5 text-right text-xs tabular-nums">{k.order}</span>
                <Crest src={k.team?.logo ?? null} name={k.team?.name ?? ''} size="xs" />
                <span className="min-w-0 flex-1 truncate">
                  {k.player?.id ? (
                    <Link href={`/pessoas/${k.player.id}`} className="hover:underline">
                      {k.player.name}
                    </Link>
                  ) : (
                    (k.player?.name ?? '—')
                  )}
                  {k.player?.number != null ? (
                    <span className="text-muted-foreground ml-1.5 text-xs">#{k.player.number}</span>
                  ) : null}
                </span>
                {k.decisive ? (
                  <Badge variant="default" radius="full" size="sm">
                    <Sparkles aria-hidden />
                    Decisivo
                  </Badge>
                ) : null}
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full',
                    k.scored ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive',
                  )}
                >
                  {k.scored ? (
                    <Check className="size-3" aria-label="Converteu" />
                  ) : (
                    <X className="size-3" aria-label="Perdeu" />
                  )}
                </span>
                <span className="w-10 text-right font-semibold tabular-nums">
                  {k.score_after.home}–{k.score_after.away}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </li>
  );
}

// ─── componente ──────────────────────────────────────────────────────────────────────────────────

/**
 * Minuto a minuto do evento: linha do tempo vertical com gols (placar parcial e assistência), cartões,
 * substituições (quem entra e quem sai, com foto, camisa e posição), VAR, pênaltis, marcos do jogo e a
 * disputa de pênaltis cobrança a cobrança. Ao vivo, o mais novo fica em cima e a lista se atualiza
 * sozinha (SSE + verificação periódica); encerrado, fica na ordem do jogo e não muda mais.
 */
export function MatchTimeline({ initial }: { initial: EventTimeline }) {
  const id = initial.event_id;
  const q = useQuery({
    queryKey: timelineKey(id),
    queryFn: () => fetchTimeline(id),
    initialData: initial,
    initialDataUpdatedAt: Date.parse(initial.generated_at),
    staleTime: initial.live ? 5_000 : Infinity,
  });
  const t = q.data;
  const refresh = useLiveRefresh({
    queryKey: timelineKey(id),
    eventIds: t.live ? [id] : [],
    enabled: t.live,
    dataUpdatedAt: q.dataUpdatedAt,
    errorUpdatedAt: q.errorUpdatedAt,
  });
  const [keyOnly, setKeyOnly] = useState(false);

  const items = useMemo(() => {
    const all = timelineItems(t).filter((it) => !keyOnly || it.type !== 'incident' || it.incident.key_moment);
    return t.live ? all.reverse() : all;
  }, [t, keyOnly]);
  const keyCount = t.incidents.filter((i) => i.key_moment && i.clock.period !== 'penalty_shootout').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {t.live ? (
          <Badge variant="destructive-light" radius="full">
            <LiveDot on />
            Ao vivo{t.clock?.display ? ` · ${t.clock.display}` : ''}
          </Badge>
        ) : (
          <Badge variant="secondary" radius="full">
            Encerrado
          </Badge>
        )}
        {t.score.home != null && t.score.away != null ? (
          <span className="text-lg font-bold tabular-nums">
            {t.score.home}–{t.score.away}
          </span>
        ) : null}
        <span className="text-muted-foreground text-xs">
          {t.live ? 'Mais recente primeiro' : 'Do apito inicial ao final'}
        </span>
        <Toggle
          size="sm"
          variant="outline"
          pressed={keyOnly}
          onPressedChange={(pressed) => setKeyOnly(pressed)}
          className="ml-auto"
          aria-label="Mostrar só os momentos-chave"
        >
          <Sparkles aria-hidden />
          Só os principais
          <span className="text-muted-foreground tabular-nums">({keyCount})</span>
        </Toggle>
      </div>

      {t.live ? <RefreshTimer state={refresh} sourceLastAt={t.data_freshness.last_valid_at} /> : null}

      {items.length ? (
        <ol className="relative before:absolute before:top-2 before:bottom-6 before:left-[4.75rem] before:w-px before:bg-border">
          {items.map((it) =>
            it.type === 'incident' ? (
              <IncidentRow key={it.key} i={it.incident} />
            ) : it.type === 'marker' ? (
              <MarkerRow key={it.key} m={it.marker} shootout={!!t.shootout} />
            ) : (
              <ShootoutBlock key={it.key} shootout={it.shootout} />
            ),
          )}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t.live
            ? 'Nenhum lance ainda. Os lances aparecem aqui assim que acontecem.'
            : 'Sem lances registrados.'}
        </p>
      )}
    </div>
  );
}
