import type { Event, EventLineups, HeadToHead, WhereToWatch } from '@galaxie/contracts';
import { Bot, CalendarClock, ExternalLink, Flame, MapPin, Tv } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { EventCard } from '@/components/sport/event-card';
import { Intensity } from '@/components/sport/intensity';
import { MatchStakes } from '@/components/sport/match-stakes';
import { Section } from '@/components/sport/section';
import { StatusBadge } from '@/components/sport/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtDateLong, fmtTime } from '@/lib/format';
import { getEvent, getEventContext, getH2h, getLineups, getWhereToWatch } from '@/lib/galaxie/api';
import { COUNTRIES } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const STARTED = new Set(['live', 'break', 'finished', 'suspended', 'abandoned']);

const CONTEXT_LABEL: Record<string, string> = {
  regular: 'Fase regular',
  derby: 'Clássico',
  playoff: 'Mata-mata',
  knockout: 'Eliminatória',
  semifinal: 'Semifinal',
  final: 'Final',
  title: 'Briga pelo título',
  lead: 'Liderança em jogo',
  relegation: 'Luta contra o rebaixamento',
};

const MEDIUM_LABEL: Record<string, string> = {
  free_tv: 'TV aberta',
  pay_tv: 'TV por assinatura',
  streaming_svod: 'Streaming por assinatura',
  streaming_free: 'Streaming gratuito',
  youtube: 'YouTube',
  official_app: 'App oficial',
  radio: 'Rádio',
};

/** Mercados de onde-assistir oferecidos na demo (ISO 3166-1 alpha-2). */
const WTW_MARKETS = COUNTRIES.map((c) => ({ code: c.code === 'GB-ENG' ? 'GB' : c.code, label: c.label }));

// ─── placar ──────────────────────────────────────────────────────────────────────────────────────

function Side({ p, align }: { p: Event['participants'][number] | undefined; align: 'left' | 'right' }) {
  if (!p) return <div className="flex-1" />;
  return (
    <Link
      href={`/times/${p.id}`}
      className={cn(
        'group/side flex flex-1 flex-col items-center gap-2 text-center sm:flex-row sm:text-left',
        align === 'right' && 'sm:flex-row-reverse sm:text-right',
      )}
    >
      <Crest src={p.logo} name={p.name} size="lg" />
      <div className="flex flex-col">
        <span className="text-lg font-semibold group-hover/side:underline">{p.name}</span>
        {p.nickname ? <span className="text-muted-foreground text-sm">{p.nickname}</span> : null}
      </div>
    </Link>
  );
}

function Scoreboard({ event }: { event: Event }) {
  const home = event.participants.find((p) => p.side === 'home') ?? event.participants[0];
  const away = event.participants.find((p) => p.side === 'away') ?? event.participants[1];
  const started = STARTED.has(event.status);
  const { score } = event;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-2 text-sm">
          {event.competition ? (
            <Link
              href={`/competicoes/${event.competition.slug}`}
              className="text-foreground flex items-center gap-2 hover:underline"
            >
              <Crest src={event.competition.logo} name={event.competition.name} size="xs" />
              {event.competition.name}
            </Link>
          ) : null}
          {event.stage?.name ? <span>· {event.stage.name}</span> : null}
          <StatusBadge event={event} />
        </div>

        <div className="flex items-center gap-4">
          <Side p={home} align="left" />
          <div className="flex shrink-0 flex-col items-center gap-1">
            {started ? (
              // Placar ausente (ex.: jogo abandonado sem dado do fornecedor) aparece como "?", não vira 0.
              <span className="text-4xl font-bold tabular-nums sm:text-5xl">
                {score.home ?? <span className="text-muted-foreground">?</span>}
                <span className="text-muted-foreground mx-2">–</span>
                {score.away ?? <span className="text-muted-foreground">?</span>}
              </span>
            ) : (
              <span className="text-3xl font-semibold tabular-nums">{fmtTime(event.starts_at)}</span>
            )}
            {score.halftime ? (
              <span className="text-muted-foreground text-xs">
                Intervalo {score.halftime.home}–{score.halftime.away}
              </span>
            ) : null}
            {score.penalty ? (
              <span className="text-muted-foreground text-xs">
                Pênaltis {score.penalty.home}–{score.penalty.away}
              </span>
            ) : null}
            {score.aggregate ? (
              <span className="text-muted-foreground text-xs">
                Agregado {score.aggregate.home}–{score.aggregate.away}
              </span>
            ) : null}
          </div>
          <Side p={away} align="right" />
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5" aria-hidden />
            {fmtDateLong(event.starts_at)}, {fmtTime(event.starts_at)}
          </span>
          {event.venue ? (
            <Link href={`/locais/${event.venue.id}`} className="flex items-center gap-1.5 hover:underline">
              <MapPin className="size-3.5" aria-hidden />
              {event.venue.name}
              {event.venue.city ? `, ${event.venue.city}` : ''}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── blocos laterais ─────────────────────────────────────────────────────────────────────────────

function AboutCard({ event }: { event: Event }) {
  const contexts = event.competition_context.filter(
    (c) => c !== 'regular' || event.competition_context.length === 1,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sobre o jogo</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {event.derby ? (
          <Link
            href={`/classicos/${event.derby.slug}`}
            className="hover:bg-accent -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors"
          >
            <Flame className="text-warning size-5" aria-hidden />
            <div className="flex flex-col">
              <span className="font-medium">{event.derby.name}</span>
              <span className="text-muted-foreground text-xs">Ver a história do clássico</span>
            </div>
            <Intensity value={event.derby.intensity} className="ml-auto" />
          </Link>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Importância editorial</span>
            <span className="font-semibold tabular-nums">{event.importance}/100</span>
          </div>
          <Progress value={event.importance} />
        </div>
        {contexts.length ? (
          <div className="flex flex-wrap gap-1.5">
            {contexts.map((c) => (
              <Badge key={c} variant="secondary">
                {CONTEXT_LABEL[c] ?? c}
              </Badge>
            ))}
          </div>
        ) : null}
        <MatchStakes event={event} />
      </CardContent>
    </Card>
  );
}

function WhereToWatchCard({
  eventId,
  wtw,
  country,
}: {
  eventId: string;
  wtw: WhereToWatch | null;
  country: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tv className="size-4" aria-hidden /> Onde assistir
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-1">
          {WTW_MARKETS.map((m) => (
            <Link
              key={m.code}
              href={`/eventos/${eventId}?pais=${m.code}`}
              scroll={false}
              title={m.label}
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-xs transition-colors',
                m.code === country ? 'bg-foreground text-background border-transparent' : 'hover:bg-accent',
              )}
            >
              {m.code}
            </Link>
          ))}
        </div>
        {wtw?.options.length ? (
          <ul className="flex flex-col gap-2">
            {wtw.options.map((o) => (
              <li key={o.id} className="flex items-center gap-3 rounded-md border p-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {o.provider}
                    {o.channel && o.channel !== o.provider ? ` · ${o.channel}` : ''}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {MEDIUM_LABEL[o.medium] ?? o.medium}
                    {o.region ? ` · ${o.region}` : ''} · confiança {Math.round(o.confidence * 100)}%
                  </span>
                </div>
                {o.watch_url ? (
                  <a href={o.watch_url} target="_blank" rel="noreferrer" aria-label={`Abrir ${o.provider}`}>
                    <ExternalLink className="text-muted-foreground size-4" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            {wtw?.message ?? 'Sem informação de transmissão para este país.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── blocos principais ───────────────────────────────────────────────────────────────────────────

function H2hSection({ h2h }: { h2h: HeadToHead }) {
  if (!h2h.summary.played) return null;
  const [a, b] = h2h.participants;
  const winsOf = (id?: string) => h2h.summary.teams.find((t) => t.id === id)?.wins ?? 0;
  const total = h2h.summary.played;
  const bars = [
    { label: a?.name ?? '', value: winsOf(a?.id), cls: 'bg-primary' },
    { label: 'Empates', value: h2h.summary.draws, cls: 'bg-muted-foreground' },
    { label: b?.name ?? '', value: winsOf(b?.id), cls: 'bg-info' },
  ];
  return (
    <Section title="Confronto direto" description={`${total} jogos na base`}>
      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          <div className="flex h-2 overflow-hidden rounded-full">
            {bars.map((x) => (
              <div key={x.label} className={x.cls} style={{ width: `${(x.value / total) * 100}%` }} />
            ))}
          </div>
          <div className="flex justify-between text-sm">
            {bars.map((x) => (
              <div key={x.label} className="flex flex-col items-center">
                <span className="text-xl font-semibold tabular-nums">{x.value}</span>
                <span className="text-muted-foreground text-xs">{x.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {h2h.events.slice(0, 6).map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>
    </Section>
  );
}

function LineupsSection({ lineups }: { lineups: EventLineups }) {
  if (!lineups.available || !lineups.lineups.length) return null;
  return (
    <Section title="Escalações">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {lineups.lineups.map((l) => (
          <Card key={l.team.id ?? l.team.name} size="sm">
            <CardHeader className="flex flex-row items-center gap-2">
              <Crest src={l.team.logo} name={l.team.name ?? ''} size="xs" />
              <CardTitle>{l.team.name}</CardTitle>
              {l.formation ? <Badge variant="outline">{l.formation}</Badge> : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {l.start_xi.map((p) => (
                <div key={`${p.person.id}-${p.number}`} className="flex items-center gap-2">
                  <span className="text-muted-foreground w-6 text-right tabular-nums">{p.number}</span>
                  {p.person.id ? (
                    <Link href={`/pessoas/${p.person.id}`} className="hover:underline">
                      {p.person.name}
                    </Link>
                  ) : (
                    <span>{p.person.name}</span>
                  )}
                  {p.position ? (
                    <span className="text-muted-foreground ml-auto text-xs">{p.position}</span>
                  ) : null}
                </div>
              ))}
              {l.coach ? <p className="text-muted-foreground mt-2 text-xs">Técnico: {l.coach.name}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}

async function Content({ params, searchParams }: PageProps<'/eventos/[id]'>) {
  const { id } = await params;
  const query = await searchParams;
  const country = typeof query.pais === 'string' ? query.pais.toUpperCase() : 'BR';

  const event = await getEvent(id);
  const [context, h2h, wtw, lineups] = await Promise.all([
    getEventContext(id),
    getH2h(id),
    getWhereToWatch(id, country),
    getLineups(id),
  ]);
  const title = event.participants.map((p) => p.name).join(' x ');

  return (
    <>
      <PageHeader title={title} kind="evento" />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Scoreboard event={event} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {context?.data.length ? (
              <Section
                title="Contexto"
                description="Cenário pré-jogo e resumo gerados a partir dos fatos, com fontes"
              >
                {context.data.map((c) => (
                  <Card key={c.kind} size="sm">
                    <CardContent className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="primary-light">{c.kind === 'recap' ? 'Resumo' : 'Cenário'}</Badge>
                        <Badge variant="outline">
                          <Bot aria-hidden />
                          {c.origin === 'llm' ? 'IA com guardrails' : 'Determinístico'}
                        </Badge>
                      </div>
                      <p className="leading-relaxed">{c.text}</p>
                    </CardContent>
                  </Card>
                ))}
              </Section>
            ) : null}
            {lineups ? <LineupsSection lineups={lineups} /> : null}
            {h2h ? <H2hSection h2h={h2h} /> : null}
          </div>
          <div className="flex flex-col gap-6">
            <AboutCard event={event} />
            <WhereToWatchCard eventId={event.id} wtw={wtw} country={country} />
          </div>
        </div>
      </div>
    </>
  );
}

function Fallback() {
  return (
    <>
      <PageHeader title={<Skeleton className="h-4 w-48" />} />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Skeleton className="h-48" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    </>
  );
}

export default function EventPage(props: PageProps<'/eventos/[id]'>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Content {...props} />
    </Suspense>
  );
}
