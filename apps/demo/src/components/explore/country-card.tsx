import type { Event, ExploreCountry } from '@galaxie/contracts';
import Link from 'next/link';

import { AnimatedIcon } from '@/components/sport/animated-sport-icon';
import { Crest } from '@/components/sport/crest';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { fill, plural } from '@/lib/i18n/text';
import type { CountryNav } from '@/lib/navigation';
import { kickoffText } from '@/lib/provisional';
import { cn } from '@/lib/utils';

import { LeagueLogo, LivePill, StatLine, TILE } from './sport-card';
import { SportTexture, TEXTURE_TONE } from './sport-texture';

type Participant = Event['participants'][number];

/** Mandante e visitante (ou os dois primeiros, em eventos sem lados). */
function sides(event: Event): [Participant | undefined, Participant | undefined] {
  const home = event.participants.find((p) => p.side === 'home') ?? event.participants[0];
  const away = event.participants.find((p) => p.side === 'away') ?? event.participants[1];
  return [home, away];
}

const teamName = (p: Participant | undefined) => p?.short_name ?? p?.name ?? '';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground text-xs font-medium">{children}</span>;
}

/** Selo da relevância (0–100) no mercado do país, com a explicação no `title`. */
function RelevanceScore({ event, hint, label }: { event: Event; hint: string; label: string }) {
  const score = event.relevance?.score ?? event.importance;
  return (
    <span
      title={hint}
      aria-label={label}
      className="text-muted-foreground inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums"
    >
      {score}
    </span>
  );
}

/** Jogo em destaque numa linha (cards padrão). */
function HighlightLine({
  event,
  t,
  f,
  countryName,
}: {
  event: Event;
  t: Dictionary;
  f: Formatters;
  countryName: string;
}) {
  const [home, away] = sides(event);
  const score = event.relevance?.score ?? event.importance;
  return (
    <Link
      href={`/eventos/${event.id}`}
      className="hover:bg-accent focus-visible:ring-ring pointer-events-auto flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors outline-none focus-visible:ring-2"
    >
      <span className="flex shrink-0 -space-x-1.5">
        <Crest src={home?.logo} name={teamName(home)} size="xs" />
        <Crest src={away?.logo} name={teamName(away)} size="xs" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-semibold">
            {teamName(home)} {t.sport.versus} {teamName(away)}
          </span>
          {event.provisional ? (
            <span
              title={t.sport.provisional.hint}
              className="text-muted-foreground shrink-0 rounded-md border px-1.5 text-[11px] leading-4 font-medium"
            >
              {t.sport.provisional.badge}
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground truncate text-[11px]">
          {kickoffText(event, f, t.sport)}
          {event.competition ? ` · ${event.competition.name}` : ''}
        </span>
      </span>
      <RelevanceScore
        event={event}
        hint={fill(t.nav.explore.relevanceHint, { country: countryName })}
        label={fill(t.nav.explore.relevance, { score })}
      />
    </Link>
  );
}

/** Jogo em destaque ampliado (cards largos): escudos grandes, o "versus" animado, horário e competição. */
function HighlightPanel({
  event,
  t,
  f,
  countryName,
}: {
  event: Event;
  t: Dictionary;
  f: Formatters;
  countryName: string;
}) {
  const [home, away] = sides(event);
  const score = event.relevance?.score ?? event.importance;
  const side = (p: Participant | undefined) => (
    <span className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      <Crest src={p?.logo} name={teamName(p)} size="md" />
      <span className="line-clamp-2 text-sm leading-tight font-semibold">{teamName(p)}</span>
    </span>
  );
  return (
    <Link
      href={`/eventos/${event.id}`}
      data-anim-trigger
      className="hover:bg-accent focus-visible:ring-ring pointer-events-auto flex h-full flex-col gap-4 rounded-lg border p-4 transition-colors outline-none focus-visible:ring-2"
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>{t.nav.explore.highlight}</SectionLabel>
        <RelevanceScore
          event={event}
          hint={fill(t.nav.explore.relevanceHint, { country: countryName })}
          label={fill(t.nav.explore.relevance, { score })}
        />
      </div>
      <div className="flex items-center gap-2">
        {side(home)}
        <AnimatedIcon name="versus" className="size-10 opacity-80 grayscale">
          <span className="text-muted-foreground m-auto text-sm font-semibold">{t.sport.versus}</span>
        </AnimatedIcon>
        {side(away)}
      </div>
      <span className="mt-auto flex flex-col items-center gap-1 text-center text-xs">
        <span className="font-medium">{kickoffText(event, f, t.sport)}</span>
        {event.competition ? (
          <span className="text-muted-foreground line-clamp-1">{event.competition.name}</span>
        ) : null}
      </span>
    </Link>
  );
}

/**
 * Card de país: bandeira e nome, os contadores numa linha, a liga principal, os clubes de maior peso e o
 * jogo de maior relevância no mercado, com o campo em traço cinza ao fundo. O card todo
 * leva à página do país; o jogo em destaque é um link próprio, por cima.
 */
export function CountryCard({
  country,
  name,
  data,
  wide = false,
  t,
  locale,
  f,
}: {
  country: CountryNav;
  name: string;
  data: ExploreCountry | undefined;
  wide?: boolean;
  t: Dictionary;
  locale: Locale;
  f: Formatters;
}) {
  const te = t.nav.explore;
  const teams = data?.top_teams ?? [];
  const main = data?.main_competition ?? null;

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {data?.flag ? (
          <img
            src={data.flag}
            alt=""
            draggable={false}
            className={cn(
              'shrink-0 rounded-[3px] object-cover shadow-sm ring-1 ring-border',
              wide ? 'h-8 w-12' : 'h-6 w-9',
            )}
          />
        ) : null}
        <h4
          className={cn('truncate font-semibold tracking-tight', wide ? 'text-xl md:text-2xl' : 'text-base')}
        >
          {name}
        </h4>
      </div>
      <LivePill count={data?.live ?? 0} t={te} />
    </div>
  );

  const league = main ? (
    <div className="flex min-w-0 flex-col gap-1">
      <SectionLabel>{te.mainLeague}</SectionLabel>
      <span className="flex min-w-0 items-center gap-2">
        <LeagueLogo competition={main} size={wide ? 'sm' : 'xs'} />
        <span className={cn('truncate font-medium', wide ? 'text-sm' : 'text-xs')}>{main.name}</span>
      </span>
    </div>
  ) : null;

  const crests = teams.length ? (
    <div className="flex min-w-0 flex-col gap-1.5">
      <SectionLabel>{te.topTeams}</SectionLabel>
      {wide ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center gap-1.5 text-xs">
              <Crest src={team.logo} name={team.name} size="xs" />
              {team.short_name ?? team.name}
            </li>
          ))}
        </ul>
      ) : (
        <span className="flex gap-1.5">
          {teams.map((team) => (
            <span key={team.id} title={team.name} className="flex">
              <Crest src={team.logo} name={team.name} size="xs" />
            </span>
          ))}
        </span>
      )}
    </div>
  ) : null;

  const announced = data?.announced.length ? (
    <div className="flex min-w-0 flex-col gap-1.5">
      <SectionLabel>{te.announced}</SectionLabel>
      {data.announced.map((e) => (
        <HighlightLine key={e.id} event={e} t={t} f={f} countryName={name} />
      ))}
    </div>
  ) : null;

  const counts = data ? (
    <StatLine
      items={[
        { value: data.competitions, label: plural(locale, data.competitions, te.units.domestic) },
        { value: data.upcoming, label: plural(locale, data.upcoming, te.units.games) },
      ]}
      locale={locale}
    />
  ) : null;

  return (
    <article className={cn(TILE, 'min-h-60', wide ? 'p-5 sm:col-span-2' : 'p-4')}>
      <SportTexture sport="football" className={cn(TEXTURE_TONE, wide ? 'w-[45%]' : 'w-[80%]')} />
      <Link
        href={country.href}
        aria-label={name}
        className="focus-visible:ring-ring absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2"
      />
      {wide ? (
        <div className="pointer-events-none grid flex-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1">
              {header}
              {counts}
            </div>
            {league}
            {crests}
            {announced}
          </div>
          {data?.highlight ? (
            <HighlightPanel event={data.highlight} t={t} f={f} countryName={name} />
          ) : (
            <NoHighlight text={te.noHighlight} />
          )}
        </div>
      ) : (
        <div className="pointer-events-none flex flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            {header}
            {counts}
          </div>
          {league}
          {crests}
          <div className="mt-auto flex flex-col gap-1.5">
            <SectionLabel>{te.highlight}</SectionLabel>
            {data?.highlight ? (
              <HighlightLine event={data.highlight} t={t} f={f} countryName={name} />
            ) : (
              <NoHighlight text={te.noHighlight} />
            )}
          </div>
          {announced}
        </div>
      )}
    </article>
  );
}

function NoHighlight({ text }: { text: string }) {
  return (
    <span className="text-muted-foreground flex items-center justify-center rounded-lg border border-dashed px-3 py-3 text-xs">
      {text}
    </span>
  );
}

/**
 * País numa linha, para o celular: bandeira, nome, liga principal e jogos da semana (com o selo "ao vivo").
 * Os 17 cards completos somavam uns 3.000 px; a linha leva à mesma página do país.
 */
export function CountryRow({
  country,
  name,
  data,
  t,
  locale,
}: {
  country: CountryNav;
  name: string;
  data: ExploreCountry | undefined;
  t: Dictionary;
  locale: Locale;
}) {
  const te = t.nav.explore;
  const main = data?.main_competition ?? null;
  return (
    <li>
      <Link
        href={country.href}
        className="hover:bg-accent focus-visible:ring-ring flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors outline-none focus-visible:ring-2"
      >
        {data?.flag ? (
          <img
            src={data.flag}
            alt=""
            draggable={false}
            className="h-6 w-9 shrink-0 rounded-[3px] object-cover shadow-sm ring-1 ring-border"
          />
        ) : (
          <span className="bg-muted h-6 w-9 shrink-0 rounded-[3px]" aria-hidden />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{name}</span>
          {main ? (
            <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              <LeagueLogo competition={main} size="xs" />
              <span className="truncate">{main.name}</span>
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <LivePill count={data?.live ?? 0} t={te} />
          {data ? (
            <span className="text-muted-foreground text-[11px] tabular-nums">
              {plural(locale, data.upcoming, te.upcomingCount)}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
