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
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { awaitingResult, ProvisionalBadgeView } from '@/components/sport/event-card-view';
import { EventCard } from '@/components/sport/event-card';
import { FightCardSection, fightResultText } from '@/components/sport/fight-card';
import { Intensity } from '@/components/sport/intensity';
import { MatchDetails } from '@/components/sport/match-details';
import { MarketTabs } from '@/components/sport/market-tabs';
import { MatchStakes } from '@/components/sport/match-stakes';
import { PeriodScores } from '@/components/sport/period-scores';
import { isRaceEvent, RaceClassification, RaceScoreboard, raceTitle } from '@/components/sport/race';
import { PhotoFigure } from '@/components/sport/race-career';
import { RelatedContentGrid } from '@/components/sport/related-content';
import { RelevanceMeter } from '@/components/sport/relevance-meter';
import { Section } from '@/components/sport/section';
import { SourceNote } from '@/components/sport/source-note';
import { BrandLogo, WhereToWatchGroups } from '@/components/sport/where-to-watch-groups';
import { StatusBadge } from '@/components/sport/status-badge';
import { ApiCodeButton } from '@/components/docs/api-code-button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  eventContextRequest,
  eventRequest,
  h2hRequest,
  relatedRequest,
  whereToWatchRequest,
} from '@/lib/galaxie/api';
import type { SupportedLocale } from '@galaxie/contracts';

import { goalsBehinds } from '@/lib/afl';
import { apiLocale, contentLocale, defaultMarket, type Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { announcementText, timeToBeConfirmed } from '@/lib/provisional';
import { versusColors } from '@/lib/team-colors';
import { COUNTRIES, eventCompetitionHref, eventParents, participantHref } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { groupWhereToWatch, hasGroups } from '@/lib/where-to-watch';

/** Título da aba do navegador (e do histórico): o nome da página, não só "Galaxie Sports". */
export async function eventMetadata(id: string, source: DataSource): Promise<Metadata> {
  const { locale, t } = await getI18n();
  try {
    const event = await source.getEvent(id, locale);
    if (isRaceEvent(event)) return { title: raceTitle(event, t.sport) };
    return { title: event.participants.map((p) => p.name).join(` ${t.sport.versus} `) };
  } catch {
    return {};
  }
}

import type { DataSource } from '@/lib/galaxie/source';
import type { PageContentProps } from './types';

const STARTED = new Set(['live', 'break', 'finished', 'suspended', 'abandoned']);

/** Mercados de onde-assistir oferecidos na demo (ISO 3166-1 alpha-2); o nome do país sai do dicionário. */
const WTW_MARKETS = COUNTRIES.map((c) => ({ code: c.code === 'GB-ENG' ? 'GB' : c.code, nav: c.code }));

/** Parcial do placar para os textos (`{home}–{away}`); lado sem dado aparece como "?", não vira 0. */
const pair = (p: { home: number | null; away: number | null }) => ({
  home: p.home ?? '?',
  away: p.away ?? '?',
});

// ─── placar ──────────────────────────────────────────────────────────────────────────────────────

function Side({
  p,
  align,
  fighter = false,
}: {
  p: Event['participants'][number] | undefined;
  align: 'left' | 'right';
  /** Lutador (MMA): foto redonda e o perdedor esmaecido depois da luta. */
  fighter?: boolean;
}) {
  if (!p) return <div className="flex-1" />;
  return (
    <Link
      href={participantHref(p, fighter ? 'fighter' : null)}
      className={cn(
        'group/side flex flex-1 flex-col items-center gap-2 text-center sm:flex-row sm:text-left',
        align === 'right' && 'sm:flex-row-reverse sm:text-right',
        fighter && p.winner === false && 'opacity-60',
      )}
    >
      <Crest src={p.logo} name={p.name} size="lg" round={fighter} />
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
  const { score, fight } = event;

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
          {fight?.weight_class ? <span>· {fight.weight_class.name}</span> : null}
          {fight?.main_event ? <Badge variant="primary-light">{t.event.fight.mainEvent}</Badge> : null}
          <ProvisionalBadgeView event={event} t={t.sport} />
          <StatusBadge event={event} />
        </div>

        <div className="flex items-center gap-4">
          <Side p={home} align="left" fighter={!!fight} />
          <div className="flex shrink-0 flex-col items-center gap-1">
            {fight && started ? (
              // luta: sem placar — o desfecho (método, golpe, round e tempo) no lugar dele
              <span className="max-w-48 text-center text-sm font-medium sm:max-w-64 sm:text-base">
                {fight.result ? (
                  fightResultText(fight.result, t)
                ) : (
                  <span className="text-muted-foreground">{t.event.fight.resultPending}</span>
                )}
              </span>
            ) : awaitingResult(event) ? (
              <span className="text-muted-foreground text-xl font-semibold">{t.sport.awaitingResult}</span>
            ) : started ? (
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
            {started && score.goals_behinds ? (
              <abbr
                title={tx.goalsBehindsTitle}
                className="text-muted-foreground text-xs tabular-nums no-underline"
              >
                {fill(tx.goalsBehinds, {
                  home: goalsBehinds(score.goals_behinds.home) ?? '?',
                  away: goalsBehinds(score.goals_behinds.away) ?? '?',
                })}
              </abbr>
            ) : null}
          </div>
          <Side p={away} align="right" fighter={!!fight} />
        </div>

        {started && score.periods?.length ? (
          <div className="flex justify-center overflow-x-auto">
            <PeriodScores
              periods={score.periods}
              home={home?.short_name ?? home?.name ?? ''}
              away={away?.short_name ?? away?.name ?? ''}
              sport={event.sport}
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
  relatedHref,
}: {
  eventId: string;
  wtw: WhereToWatch | null;
  country: string;
  locale: Locale;
  content: SupportedLocale;
  t: Dictionary;
  /** Âncora dos vídeos relacionados (melhores momentos) do jogo, quando existem. */
  relatedHref?: string | null;
}) {
  const tx = t.event.whereToWatch;
  // TV aberta, canais pagos e "disponível também em" (operadoras e streamings com o plano)
  const groups = wtw ? groupWhereToWatch(wtw) : null;
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
        {groups && hasGroups(groups) ? (
          <WhereToWatchGroups groups={groups} t={tx} listLocale={content} relatedHref={relatedHref} />
        ) : wtw?.to_confirm?.length ? (
          // Direitos conhecidos no país, mas o canal deste jogo ainda não foi alocado pela rodada.
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              {/* encerrado sem canal confirmado: nunca "sai mais perto da partida" */}
              {wtw.availability?.match_channel?.state === 'not_confirmed'
                ? tx.rightsHoldersPost
                : tx.rightsHolders}
            </p>
            <ul className="flex flex-col gap-2">
              {wtw.to_confirm.map((c) => (
                <li
                  key={c.provider_id ?? c.provider}
                  className="flex items-center gap-3 rounded-md border border-dashed p-2"
                >
                  {c.logo ? (
                    <BrandLogo name={c.provider} logo={c.logo} logoDark={c.logo_dark} />
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
  f,
}: {
  h2h: HeadToHead;
  locale: Locale;
  content: SupportedLocale;
  t: Dictionary;
  f: Formatters;
}) {
  const tx = t.event.h2h;
  if (!h2h.summary.played) return null;
  const all = h2h.all_time;
  const allWinsOf = (id?: string) => all?.teams.find((t) => t.id === id)?.wins ?? 0;
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
      description={
        // sem o ano do primeiro jogo (cópia gravada antiga do exemplo), a frase sai sem ele
        h2h.summary.since == null
          ? plural(locale, total, tx.matchesAnyYear)
          : plural(locale, total, tx.matches, { year: h2h.summary.since })
      }
      api={h2hRequest(h2h.event_id, locale, content)}
    >
      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          {all ? (
            // histórico geral curado em destaque; as barras abaixo são só o recorte da base
            <div className="flex flex-col gap-1 border-b pb-3">
              <span className="text-xs font-medium">
                {all.derby ? fill(tx.allTime, { derby: all.derby.name }) : tx.allTimePair}
              </span>
              <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
                <span>
                  <span className="text-lg font-semibold">{allWinsOf(a?.id)}</span> {a?.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {fill(tx.allTimeRecord, {
                    matches: plural(locale, all.matches, t.pages.derby.matches),
                    draws: plural(locale, all.draws, t.pages.derby.draws),
                  })}
                  {all.basis === 'official' ? ` (${tx.officialOnly})` : null}
                </span>
                <span>
                  {b?.name} <span className="text-lg font-semibold">{allWinsOf(b?.id)}</span>
                </span>
              </div>
              <span className="text-muted-foreground text-xs">
                <SourceNote template={tx.allTimeNote} date={f.calendarDate(all.as_of)} urls={all.sources} />
              </span>
            </div>
          ) : null}
          {all && h2h.summary.since !== null ? (
            <span className="text-xs font-medium">{fill(tx.ourData, { year: h2h.summary.since })}</span>
          ) : null}
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

export async function EventContent({ params, searchParams, source }: PageContentProps) {
  const [{ id }, query, { locale, t }, f] = await Promise.all([
    params,
    searchParams,
    getI18n(),
    getFormatters(),
  ]);
  // Onde assistir começa no mercado do idioma (Argentina em espanhol; Brasil nos demais). O país dele
  // não mexe na relevância: o card "Sobre o jogo" mostra todos os países (`relevance_by_market`).
  const country = typeof query.pais === 'string' ? query.pais.toUpperCase() : defaultMarket(locale);

  const first = await source.getEvent(id, locale);
  // tags do torcedor, gritos e contexto na voz do país do mandante (um jogo no Chile sai em es-CL), com a
  // interface no idioma escolhido; em pt-BR, tudo em português
  const home = first.participants.find((p) => p.side === 'home');
  const content = contentLocale(locale, home ? await source.getTeamCountry(home.id) : null);
  const event = content === apiLocale(locale) ? first : await source.getEvent(id, content);
  const [context, h2h, wtw, lineups, related, timeline, stats, fightCard] = await Promise.all([
    source.getEventContext(id, content),
    source.getH2h(id, content),
    source.getWhereToWatch(id, country, content),
    source.getLineups(id, content),
    source.getRelated(id, content, country),
    source.getTimeline(id, content),
    source.getStats(id, content),
    first.sport === 'mma' ? source.getEventCard(id, content) : null,
  ]);
  // minuto a minuto: a partir do apito (ou quando já há lance registrado); os marcos sem lance (início,
  // intervalo, 2º tempo) são do futebol: nos outros esportes, só com lances do fornecedor
  const showTimeline =
    !!timeline &&
    (timeline.incidents.length > 0 || (event.sport === 'football' && STARTED.has(event.status)));
  // corrida (F1): vários pilotos no grid; o título é o GP e a sessão, não "A x B x C…"
  const race = isRaceEvent(event);
  // F1: o carro do vencedor naquela temporada (acervo de fotos de licença livre), com o crédito
  const winnerTeam = race
    ? event.participants.find((p) => p.side === 'grid' && p.position === 1)?.result?.team?.id
    : null;
  const winnerCar = winnerTeam
    ? ((await source.getTeamPhotos(winnerTeam, 'car', Number(event.starts_at.slice(0, 4))))?.photos[0] ??
      null)
    : null;
  const title = race
    ? raceTitle(event, t.sport)
    : event.participants.map((p) => p.name).join(` ${t.sport.versus} `);
  // cor de cada time (escudo) no campo e nas estatísticas, tratando escudo monocromático e cores parecidas
  const colors = versusColors(
    event.participants.find((p) => p.side === 'home')?.colors,
    event.participants.find((p) => p.side === 'away')?.colors,
  );
  const tx = t.event.context;
  // a trilha: esporte › competição › rodada
  const parents = eventParents(event, t);

  return (
    <>
      <PageHeader
        title={title}
        kind="evento"
        parents={parents}
        api={eventRequest(id, locale, undefined, content)}
      />
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
            {winnerCar ? (
              <Section title={t.race.gallery.carOfWinner!}>
                <PhotoFigure photo={winnerCar} imgClassName="max-h-96" />
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
            {fightCard ? (
              <FightCardSection
                card={fightCard}
                currentId={id}
                locale={locale}
                content={content}
                t={t}
                f={f}
              />
            ) : null}
            {/* corrida: a classificação acima substitui os detalhes da partida (linha do tempo é do futebol) */}
            {race ? null : (
              <MatchDetails
                eventId={id}
                timeline={showTimeline ? timeline : null}
                stats={stats}
                lineups={lineups}
                colors={colors}
                query={query}
                timeZone={f.timeZone}
                locale={locale}
                content={content}
                t={t}
              />
            )}
            {h2h ? <H2hSection h2h={h2h} locale={locale} content={content} t={t} f={f} /> : null}
          </div>
          {/* no celular, uma coluna só: placar → sobre o jogo → onde assistir → contexto → detalhes da partida → o resto */}
          <div className="flex flex-col gap-6 max-lg:order-first">
            <AboutCard event={event} t={t} />
            {/* fora do exemplo público: nomes e logos de emissoras ficam só na demo logada */}
            {source.showcase ? null : (
              <WhereToWatchCard
                eventId={event.id}
                wtw={wtw}
                country={country}
                locale={locale}
                content={content}
                t={t}
                relatedHref={related?.data.length ? '#conteudo-relacionado' : null}
              />
            )}
          </div>
        </div>
        {!source.showcase && related?.data.length ? (
          <div id="conteudo-relacionado" className="scroll-mt-20">
            <Section
              title={t.event.related.title}
              icon={<Clapperboard className="size-4" aria-hidden />}
              description={t.event.related.description}
              api={relatedRequest(id, locale, content, country)}
            >
              <RelatedContentGrid related={related} />
            </Section>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function EventFallback() {
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
