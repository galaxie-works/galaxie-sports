import type { Event, HeadToHead, WhereToWatch } from '@galaxie/contracts';
import {
  BadgeInfo,
  Bot,
  CalendarClock,
  Clapperboard,
  ExternalLink,
  Flame,
  MapPin,
  Tv,
  Whistle,
} from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { ProvisionalBadgeView } from '@/components/sport/event-card-view';
import { EventCard } from '@/components/sport/event-card';
import { Intensity } from '@/components/sport/intensity';
import { MatchDetails } from '@/components/sport/match-details';
import { MarketTabs } from '@/components/sport/market-tabs';
import { MatchStakes } from '@/components/sport/match-stakes';
import { PeriodScores } from '@/components/sport/period-scores';
import { isRaceEvent, RaceClassification, RaceScoreboard, raceTitle } from '@/components/sport/race';
import { RelatedContentGrid } from '@/components/sport/related-content';
import { RelevanceMeter } from '@/components/sport/relevance-meter';
import { Section } from '@/components/sport/section';
import { StatusBadge } from '@/components/sport/status-badge';
import { ApiCodeButton } from '@/components/docs/api-code-button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  eventContextRequest,
  eventRequest,
  getEvent,
  getTeamCountry,
  getEventContext,
  getH2h,
  getLineups,
  getRelated,
  getStats,
  getTimeline,
  getWhereToWatch,
  h2hRequest,
  relatedRequest,
  whereToWatchRequest,
} from '@/lib/galaxie/api';
import type { SupportedLocale } from '@galaxie/contracts';

import { apiLocale, contentLocale, defaultMarket, type Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { lineupMarks } from '@/lib/lineup-marks';
import { announcementText, timeToBeConfirmed } from '@/lib/provisional';
import { versusColors } from '@/lib/team-colors';
import { COUNTRIES } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const STARTED = new Set(['live', 'break', 'finished', 'suspended', 'abandoned']);

/** Mercados de onde-assistir oferecidos na demo (ISO 3166-1 alpha-2); o nome do país sai do dicionário. */
const WTW_MARKETS = COUNTRIES.map((c) => ({ code: c.code === 'GB-ENG' ? 'GB' : c.code, nav: c.code }));

/** Parcial do placar para os textos (`{home}–{away}`); lado sem dado aparece como "?", não vira 0. */
const pair = (p: { home: number | null; away: number | null }) => ({
  home: p.home ?? '?',
  away: p.away ?? '?',
});

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

function Scoreboard({ event, t, f }: { event: Event; t: Dictionary; f: Formatters }) {
  const tx = t.event.scoreboard;
  const home = event.participants.find((p) => p.side === 'home') ?? event.participants[0];
  const away = event.participants.find((p) => p.side === 'away') ?? event.participants[1];
  const started = STARTED.has(event.status);
  const tbc = timeToBeConfirmed(event);
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
          <ProvisionalBadgeView event={event} t={t.sport} />
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
            ) : tbc ? (
              <span className="text-muted-foreground text-xl font-semibold">{t.sport.provisional.tbc}</span>
            ) : (
              <span className="text-3xl font-semibold tabular-nums">{f.time(event.starts_at)}</span>
            )}
            {score.halftime ? (
              <span className="text-muted-foreground text-xs">{fill(tx.halftime, pair(score.halftime))}</span>
            ) : null}
            {score.penalty ? (
              <span className="text-muted-foreground text-xs">{fill(tx.penalties, pair(score.penalty))}</span>
            ) : null}
            {score.aggregate ? (
              <span className="text-muted-foreground text-xs">
                {fill(tx.aggregate, pair(score.aggregate))}
              </span>
            ) : null}
          </div>
          <Side p={away} align="right" />
        </div>

        {started && score.periods?.length ? (
          <div className="flex justify-center overflow-x-auto">
            <PeriodScores
              periods={score.periods}
              home={home?.short_name ?? home?.name ?? ''}
              away={away?.short_name ?? away?.name ?? ''}
            />
          </div>
        ) : null}

        <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5" aria-hidden />
            {tbc
              ? `${f.dateLong(event.starts_at)} · ${t.sport.provisional.timeTbc}`
              : fill(tx.dateAtTime, { date: f.dateLong(event.starts_at), time: f.time(event.starts_at) })}
          </span>
          {event.venue ? (
            <Link href={`/locais/${event.venue.id}`} className="flex items-center gap-1.5 hover:underline">
              <MapPin className="size-3.5" aria-hidden />
              {event.venue.name}
              {event.venue.city ? `, ${event.venue.city}` : ''}
            </Link>
          ) : null}
          {event.referee ? (
            <span className="flex items-center gap-1.5" title={tx.referee}>
              <Whistle className="size-3.5" aria-hidden />
              <span className="sr-only">{tx.referee}:</span>
              {event.referee.name}
            </span>
          ) : null}
        </div>

        {event.provisional ? <ProvisionalNotice provisional={event.provisional} t={t} /> : null}
      </CardContent>
    </Card>
  );
}

/** Aviso do jogo provisório: quem anunciou, o que falta confirmar, a observação e as fontes. */
function ProvisionalNotice({
  provisional,
  t,
}: {
  provisional: NonNullable<Event['provisional']>;
  t: Dictionary;
}) {
  const tx = t.sport.provisional;
  return (
    <div className="border-info/20 bg-info/5 flex gap-3 rounded-lg border px-4 py-3 text-sm">
      <BadgeInfo className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{announcementText(provisional, t.sport)}</span>
        {provisional.note ? <span className="text-muted-foreground">{provisional.note}</span> : null}
        <span className="text-muted-foreground text-xs">{tx.hint}</span>
        {provisional.sources.length ? (
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{tx.sources}:</span>
            {provisional.sources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
              >
                {s.name}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── blocos laterais ─────────────────────────────────────────────────────────────────────────────

function AboutCard({ event, t }: { event: Event; t: Dictionary }) {
  const tx = t.event.about;
  const contexts = event.competition_context.filter(
    (c) => c !== 'regular' || event.competition_context.length === 1,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx.title}</CardTitle>
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
              <span className="text-muted-foreground text-xs">{tx.derbyHistory}</span>
            </div>
            <Intensity value={event.derby.intensity} className="ml-auto" />
          </Link>
        ) : null}
        <RelevanceMeter event={event} />
        {contexts.length ? (
          <div className="flex flex-wrap gap-1.5">
            {contexts.map((c) => (
              <Badge key={c} variant="secondary">
                {tx.context[c] ?? c}
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
  locale,
  content,
  t,
}: {
  eventId: string;
  wtw: WhereToWatch | null;
  country: string;
  locale: Locale;
  content: SupportedLocale;
  t: Dictionary;
}) {
  const tx = t.event.whereToWatch;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tv className="size-4" aria-hidden /> {tx.title}
        </CardTitle>
        <CardAction>
          <ApiCodeButton request={whereToWatchRequest(eventId, country, locale, content)} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <MarketTabs
          eventId={eventId}
          active={country}
          markets={WTW_MARKETS.map((m) => ({
            code: m.code,
            flag: m.nav,
            name: t.nav.countries[m.nav] ?? m.code,
          }))}
        />
        {wtw?.options.length ? (
          <ul className="flex flex-col gap-2">
            {wtw.options.map((o) => (
              <li key={o.id} className="flex items-center gap-3 rounded-md border p-2">
                {o.logo ? (
                  // logo da biblioteca de emissoras (espelho S3; a versão escura do acervo oficial, já
                  // que a demo é só tema escuro); não passa pelo otimizador do Next
                  <img src={o.logo_dark ?? o.logo} alt="" className="h-9 w-12 shrink-0 object-contain" />
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {o.provider}
                    {o.channel && o.channel !== o.provider ? ` · ${o.channel}` : ''}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {tx.medium[o.medium] ?? o.medium}
                    {o.region ? ` · ${o.region}` : ''} ·{' '}
                    {fill(tx.confidence, { value: Math.round(o.confidence * 100) })}
                  </span>
                </div>
                {o.watch_url ? (
                  <a
                    href={o.watch_url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={fill(tx.open, { provider: o.provider })}
                  >
                    <ExternalLink className="text-muted-foreground size-4" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : wtw?.to_confirm?.length ? (
          // Direitos conhecidos no país, mas o canal deste jogo ainda não foi alocado pela rodada.
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">{tx.rightsHolders}</p>
            <ul className="flex flex-col gap-2">
              {wtw.to_confirm.map((c) => (
                <li
                  key={c.provider_id ?? c.provider}
                  className="flex items-center gap-3 rounded-md border border-dashed p-2"
                >
                  {c.logo ? (
                    <img src={c.logo_dark ?? c.logo} alt="" className="h-9 w-12 shrink-0 object-contain" />
                  ) : (
                    <Tv className="text-muted-foreground size-5 w-12 shrink-0" aria-hidden />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{c.provider}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {tx.medium[c.medium] ?? c.medium}
                      {c.sources?.[0] ? ` · ${fill(tx.source, { publisher: c.sources[0].publisher })}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">
            {/* `message` já vem no idioma pedido à API */}
            {wtw?.message ?? tx.empty}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── blocos principais ───────────────────────────────────────────────────────────────────────────

function H2hSection({
  h2h,
  locale,
  content,
  t,
}: {
  h2h: HeadToHead;
  locale: Locale;
  content: SupportedLocale;
  t: Dictionary;
}) {
  const tx = t.event.h2h;
  if (!h2h.summary.played) return null;
  const [a, b] = h2h.participants;
  const winsOf = (id?: string) => h2h.summary.teams.find((t) => t.id === id)?.wins ?? 0;
  const total = h2h.summary.played;
  // cor predominante de cada escudo: quem leva a melhor no confronto fica visível pela cor
  const [colorA, colorB] = versusColors(a?.colors, b?.colors);
  const bars = [
    { label: a?.name ?? '', value: winsOf(a?.id), color: colorA },
    { label: tx.draws, value: h2h.summary.draws, color: 'var(--muted-foreground)' },
    { label: b?.name ?? '', value: winsOf(b?.id), color: colorB },
  ];
  return (
    <Section
      title={tx.title}
      description={plural(locale, total, tx.matches)}
      api={h2hRequest(h2h.event_id, locale, content)}
    >
      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          <div className="flex h-2 overflow-hidden rounded-full">
            {bars.map((x) => (
              <div key={x.label} style={{ width: `${(x.value / total) * 100}%`, backgroundColor: x.color }} />
            ))}
          </div>
          <div className="flex justify-between text-sm">
            {bars.map((x) => (
              <div key={x.label} className="flex flex-col items-center">
                <span className="text-xl font-semibold tabular-nums">{x.value}</span>
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <span className="size-2 rounded-full" style={{ backgroundColor: x.color }} aria-hidden />
                  {x.label}
                </span>
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

async function Content({ params, searchParams }: PageProps<'/[locale]/eventos/[id]'>) {
  const [{ id }, query, { locale, t }, f] = await Promise.all([
    params,
    searchParams,
    getI18n(),
    getFormatters(),
  ]);
  // Onde assistir começa no mercado do idioma (Argentina em espanhol; Brasil nos demais). O país dele
  // não mexe na relevância: o card "Sobre o jogo" mostra todos os países (`relevance_by_market`).
  const country = typeof query.pais === 'string' ? query.pais.toUpperCase() : defaultMarket(locale);

  const first = await getEvent(id, locale);
  // tags do torcedor, gritos e contexto na voz do país do mandante (um jogo no Chile sai em es-CL), com a
  // interface no idioma escolhido; em pt-BR, tudo em português
  const home = first.participants.find((p) => p.side === 'home');
  const content = contentLocale(locale, home ? await getTeamCountry(home.id) : null);
  const event = content === apiLocale(locale) ? first : await getEvent(id, content);
  const [context, h2h, wtw, lineups, related, timeline, stats] = await Promise.all([
    getEventContext(id, content),
    getH2h(id, content),
    getWhereToWatch(id, country, content),
    getLineups(id, content),
    getRelated(id, content, country),
    getTimeline(id, content),
    getStats(id, content),
  ]);
  // minuto a minuto: a partir do apito (ou quando já há lance registrado); os marcos sem lance (início,
  // intervalo, 2º tempo) são do futebol: nos outros esportes, só com lances do fornecedor
  const showTimeline =
    !!timeline &&
    (timeline.incidents.length > 0 || (event.sport === 'football' && STARTED.has(event.status)));
  // corrida (F1): vários pilotos no grid; o título é o GP e a sessão, não "A x B x C…"
  const race = isRaceEvent(event);
  const title = race ? raceTitle(event) : event.participants.map((p) => p.name).join(` ${t.sport.versus} `);
  // cor de cada time (escudo) no campo e nas estatísticas, tratando escudo monocromático e cores parecidas
  const colors = versusColors(
    event.participants.find((p) => p.side === 'home')?.colors,
    event.participants.find((p) => p.side === 'away')?.colors,
  );
  const tx = t.event.context;

  return (
    <>
      <PageHeader title={title} kind="evento" api={eventRequest(id, locale, undefined, content)} />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {race ? <RaceScoreboard event={event} t={t} f={f} /> : <Scoreboard event={event} t={t} f={f} />}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {race ? (
              <Section
                title={t.race.classification}
                description={t.race.classificationDescription}
                api={eventRequest(id, locale, undefined, content)}
              >
                <RaceClassification event={event} />
              </Section>
            ) : null}
            {/* contexto (cenário e resumo) sempre acima dos detalhes da partida */}
            {context?.data.length ? (
              <Section
                title={tx.title}
                description={tx.description}
                api={eventContextRequest(id, locale, content)}
              >
                {context.data.map((c) => (
                  <Card key={c.kind} size="sm">
                    <CardContent className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="primary-light">{c.kind === 'recap' ? tx.recap : tx.scenario}</Badge>
                        <Badge variant="outline">
                          <Bot aria-hidden />
                          {c.origin === 'llm' ? tx.llm : tx.fallback}
                        </Badge>
                      </div>
                      {/* texto gerado no locale pedido à API (sem fallback entre idiomas) */}
                      <p className="leading-relaxed">{c.text}</p>
                    </CardContent>
                  </Card>
                ))}
              </Section>
            ) : null}
            {/* corrida: a classificação acima substitui os detalhes da partida (linha do tempo é do futebol) */}
            {race ? null : (
              <MatchDetails
                eventId={id}
                timeline={showTimeline ? timeline : null}
                stats={stats}
                lineups={lineups}
                marks={lineupMarks(timeline)}
                colors={colors}
                query={query}
                timeZone={f.timeZone}
                locale={locale}
                content={content}
                t={t}
              />
            )}
            {h2h ? <H2hSection h2h={h2h} locale={locale} content={content} t={t} /> : null}
          </div>
          {/* no celular, uma coluna só: placar → sobre o jogo → onde assistir → contexto → detalhes da partida → o resto */}
          <div className="flex flex-col gap-6 max-lg:order-first">
            <AboutCard event={event} t={t} />
            <WhereToWatchCard
              eventId={event.id}
              wtw={wtw}
              country={country}
              locale={locale}
              content={content}
              t={t}
            />
          </div>
        </div>
        {related?.data.length ? (
          <Section
            title={t.event.related.title}
            icon={<Clapperboard className="size-4" aria-hidden />}
            description={t.event.related.description}
            api={relatedRequest(id, locale, content, country)}
          >
            <RelatedContentGrid related={related} />
          </Section>
        ) : null}
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

export default function EventPage(props: PageProps<'/[locale]/eventos/[id]'>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Content {...props} />
    </Suspense>
  );
}
