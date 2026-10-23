import type { Event, ExploreCountry } from '@galaxie/contracts';
import Link from 'next/link';

import { AnimatedIcon } from '@/components/sport/animated-sport-icon';
import { Crest } from '@/components/sport/crest';
import { BRAND_HUE } from '@/lib/explore';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { fill, plural } from '@/lib/i18n/text';
import type { CountryNav } from '@/lib/navigation';
import { kickoffText } from '@/lib/provisional';
import { cn } from '@/lib/utils';

import { LeagueLogo, LivePill, Stat } from './sport-card';

type Participant = Event['participants'][number];

/** Mandante e visitante (ou os dois primeiros, em eventos sem lados). */
function sides(event: Event): [Participant | undefined, Participant | undefined] {
  const home = event.participants.find((p) => p.side === 'home') ?? event.participants[0];
  const away = event.participants.find((p) => p.side === 'away') ?? event.participants[1];
  return [home, away];
}

const teamName = (p: Participant | undefined) => p?.short_name ?? p?.name ?? '';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.08em] uppercase">
      {children}
    </span>
  );
}

/** Selo da relevância (0–100) no mercado do país, com a explicação no `title`. */
function RelevanceScore({ event, hint, label }: { event: Event; hint: string; label: string }) {
  const score = event.relevance?.score ?? event.importance;
  return (
    <span
      title={hint}
      aria-label={label}
      className="bg-primary/15 text-primary ring-primary/30 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1"
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
      className="bg-background/55 hover:bg-background/80 focus-visible:ring-ring pointer-events-auto flex items-center gap-2.5 rounded-lg px-2.5 py-2 ring-1 ring-white/10 transition-colors outline-none focus-visible:ring-2"
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
              className="bg-info/15 text-info shrink-0 rounded-full px-1.5 text-[10px] leading-4 font-medium"
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

/** Jogo em destaque ampliado (cards largos): escudos grandes, o "versus" animado e a barra de relevância. */
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
      className="bg-background/55 hover:bg-background/75 focus-visible:ring-ring pointer-events-auto flex h-full flex-col gap-3 rounded-xl p-4 ring-1 ring-white/10 transition-colors outline-none focus-visible:ring-2"
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
        <AnimatedIcon name="versus" className="size-10">
          <span className="text-muted-foreground m-auto text-sm font-semibold">{t.sport.versus}</span>
        </AnimatedIcon>
        {side(away)}
      </div>
      <div className="mt-auto flex flex-col gap-1.5">
        <span className="flex flex-col items-center gap-1 text-center text-xs">
          {event.competition ? (
            <span className="text-muted-foreground flex max-w-full items-center gap-1.5">
              <LeagueLogo competition={event.competition} size="xs" />
              <span className="line-clamp-1">{event.competition.name}</span>
            </span>
          ) : null}
          <span className="font-medium">{kickoffText(event, f, t.sport)}</span>
        </span>
        <span className="bg-muted/60 h-1 overflow-hidden rounded-full" aria-hidden>
          <span className="bg-primary block h-full rounded-full" style={{ width: `${score}%` }} />
        </span>
      </div>
    </Link>
  );
}

/**
 * Card de país: a bandeira esmaecida ao fundo (com máscara, para o texto seguir legível), a liga
 * principal, os clubes de maior peso, os contadores e o jogo de maior relevância no mercado. O card todo
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
              'shrink-0 rounded-[3px] object-cover shadow-sm ring-1 ring-white/15',
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
        <ul className="flex flex-wrap gap-1.5">
          {teams.map((team) => (
            <li
              key={team.id}
              className="bg-background/50 flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-xs font-medium ring-1 ring-white/10"
            >
              <Crest src={team.logo} name={team.name} size="xs" />
              {team.short_name ?? team.name}
            </li>
          ))}
        </ul>
      ) : (
        <span className="flex -space-x-1">
          {teams.map((team) => (
            <span
              key={team.id}
              title={team.name}
              className="bg-background/70 flex size-8 items-center justify-center rounded-full ring-2 ring-[var(--card)]"
            >
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
    <div className={cn('grid grid-cols-2 gap-3', wide && 'max-w-xs')}>
      <Stat
        value={data.competitions}
        label={plural(locale, data.competitions, te.units.domestic)}
        locale={locale}
      />
      <Stat value={data.upcoming} label={plural(locale, data.upcoming, te.units.games)} locale={locale} />
    </div>
  ) : null;

  return (
    <article
      style={{ '--hue': BRAND_HUE } as React.CSSProperties}
      className={cn(
        'explore-card flex min-h-60 flex-col overflow-hidden rounded-xl border',
        wide ? 'p-5 sm:col-span-2' : 'p-4',
      )}
    >
      {data?.flag ? (
        <img
          src={data.flag}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 h-full object-cover opacity-[0.18] saturate-[1.1] [mask-image:linear-gradient(to_left,black,transparent)]',
            wide ? 'w-1/2' : 'w-[78%]',
          )}
        />
      ) : null}
      <Link
        href={country.href}
        aria-label={name}
        className="focus-visible:ring-ring absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2"
      />
      {wide ? (
        <div className="pointer-events-none grid flex-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {header}
            {league}
            {counts}
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
            {data ? (
              <p className="text-muted-foreground text-xs">
                {plural(locale, data.competitions, te.domesticCount)} ·{' '}
                {plural(locale, data.upcoming, te.upcomingCount)}
              </p>
            ) : null}
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
    <span className="text-muted-foreground bg-background/40 flex items-center justify-center rounded-lg px-3 py-3 text-xs ring-1 ring-white/5">
      {text}
    </span>
  );
}
