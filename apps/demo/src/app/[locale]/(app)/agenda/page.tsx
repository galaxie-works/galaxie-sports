import type { ExploreAgenda } from '@galaxie/contracts';
import { CalendarDays, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { CountryFlag } from '@/components/sport/country-flag';
import { EventCard } from '@/components/sport/event-card';
import { FilterChip } from '@/components/sport/filter-chip';
import { FilterCombobox } from '@/components/sport/filter-combobox';
import { ScrollRow } from '@/components/sport/scroll-row';
import { Section } from '@/components/sport/section';
import { Skeleton } from '@/components/ui/skeleton';
import { exploreAgendaRequest, getExploreAgenda } from '@/lib/galaxie/api';
import { agendaHref, readAgendaParams, type AgendaParams } from '@/lib/explore-index';
import { defaultMarket, type Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { COUNTRIES, sportBySlug } from '@/lib/navigation';
import type { TrailVisit } from '@/lib/trail';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.explore.index.agendaTitle };
}

/** Jogos por página do dia: "Ver mais" aumenta até o máximo da API. */
const PAGE = 60;
const MAX_PAGE = 200;

/** Link da agenda com mais jogos do dia na página (`?limite=`). */
function withLimit(href: string, limit: number) {
  const url = new URL(href, 'http://agenda.local');
  url.searchParams.set('limite', String(limit));
  return `${url.pathname}${url.search}`;
}

/** "Hoje", "Amanhã" ou "sáb., 26/10" — o dia civil no fuso da API para o idioma. */
function dayLabel(date: string, index: number, locale: Locale, t: Dictionary) {
  if (index === 0) return t.nav.explore.index.today;
  if (index === 1) return t.nav.explore.index.tomorrow;
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function Filters({
  agenda,
  params,
  t,
  locale,
}: {
  agenda: ExploreAgenda;
  params: AgendaParams;
  t: Dictionary;
  locale: Locale;
}) {
  const ti = t.nav.explore.index;
  const filtered = !!(params.esporte || params.pais || params.competicao);
  // trocar um filtro volta ao primeiro dia com jogos (o dia escolhido pode ficar vazio)
  const href = (change: AgendaParams) => agendaHref({ ...params, dia: null, ...change });
  const countryCount = new Map(agenda.facets.countries.map((c) => [c.code, c.count]));
  return (
    <div className="flex flex-col gap-3">
      <ScrollRow
        className="gap-2 py-0.5"
        label={ti.sport}
        previous={t.common.scrollPrevious}
        next={t.common.scrollNext}
      >
        <FilterChip href={href({ esporte: null, competicao: null })} active={!params.esporte}>
          {ti.all}
        </FilterChip>
        {agenda.facets.sports.map((s) => {
          const nav = sportBySlug(s.slug);
          return (
            <FilterChip
              key={s.slug}
              href={href({ esporte: s.slug, competicao: null })}
              active={params.esporte === s.slug}
            >
              {nav ? t.nav.sports[nav.slug] : s.slug}{' '}
              <span className="tabular-nums opacity-70">{s.count}</span>
            </FilterChip>
          );
        })}
      </ScrollRow>
      <ScrollRow
        className="gap-2 py-0.5"
        label={ti.country}
        previous={t.common.scrollPrevious}
        next={t.common.scrollNext}
      >
        <FilterChip href={href({ pais: null, competicao: null })} active={!params.pais}>
          {ti.all}
        </FilterChip>
        {COUNTRIES.map((c) => (
          <FilterChip
            key={c.code}
            href={href({ pais: c.code, competicao: null })}
            active={params.pais === c.code}
          >
            <span className="inline-flex items-center gap-1.5">
              <CountryFlag code={c.code} />
              {t.nav.countries[c.code]}
              <span className="tabular-nums opacity-70">{countryCount.get(c.code) ?? 0}</span>
            </span>
          </FilterChip>
        ))}
      </ScrollRow>
      <div className="flex flex-wrap items-center gap-3">
        <FilterCombobox
          param="competicao"
          value={params.competicao ?? null}
          reset={['dia', 'limite']}
          options={agenda.facets.competitions.map((c) => ({
            value: c.slug,
            label: c.name,
            hint: plural(locale, c.count, ti.dayGames),
          }))}
          texts={{
            label: ti.competition,
            all: ti.allCompetitions,
            search: ti.searchCompetition,
            empty: ti.noCompetition,
          }}
        />
        {filtered ? (
          <Link href={agendaHref({})} className="text-primary text-xs hover:underline">
            {ti.clearFilters}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<'/[locale]/agenda'>['searchParams'] }) {
  const search = await searchParams;
  const params = readAgendaParams(search);
  const limit = Math.min(MAX_PAGE, Math.max(PAGE, Number(search.limite) || PAGE));
  const { locale, t } = await getI18n();
  const ti = t.nav.explore.index;
  const query = {
    sport: params.esporte ?? undefined,
    country: params.pais ?? undefined,
    competition: params.competicao ?? undefined,
    day: params.dia ?? undefined,
    limit,
  };
  const agenda = await getExploreAgenda(locale, query);
  const api = exploreAgendaRequest(locale, query);
  const market = defaultMarket(locale);
  const marketName = (t.nav.countries as Record<string, string>)[market] ?? market;
  const dayIndex = agenda.days.findIndex((d) => d.date === agenda.day);
  const dayCount = agenda.days[dayIndex]?.count ?? 0;

  return (
    <div className="flex flex-col gap-8 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{ti.agendaTitle}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{ti.agendaIntro}</p>
        <p className="text-sm font-medium tabular-nums">{plural(locale, agenda.total, ti.totalFiltered)}</p>
      </div>

      <Filters agenda={agenda} params={params} t={t} locale={locale} />

      {agenda.total === 0 ? (
        <EmptyState title={ti.noGamesWindow} />
      ) : (
        <>
          {agenda.highlights.length ? (
            <Section
              title={fill(ti.highlights, { country: marketName })}
              description={ti.highlightsDescription}
              icon={<Sparkles className="size-4 text-amber-500" aria-hidden />}
              api={api}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {agenda.highlights.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </div>
            </Section>
          ) : null}

          <div className="flex flex-col gap-4">
            <ScrollRow
              className="gap-2 py-0.5"
              label={ti.days}
              previous={t.common.scrollPrevious}
              next={t.common.scrollNext}
            >
              {agenda.days.map((d, i) => (
                <FilterChip
                  key={d.date}
                  href={agendaHref({ ...params, dia: d.date })}
                  active={d.date === agenda.day}
                >
                  {dayLabel(d.date, i, locale, t)} <span className="tabular-nums opacity-70">{d.count}</span>
                </FilterChip>
              ))}
            </ScrollRow>
            <Section
              title={agenda.day ? dayLabel(agenda.day, dayIndex, locale, t) : ti.agendaTitle}
              description={plural(locale, dayCount, ti.dayGames)}
              icon={<CalendarDays className="text-muted-foreground size-4" aria-hidden />}
              api={api}
            >
              {agenda.data.length ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {agenda.data.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              ) : (
                <EmptyState title={ti.noGames} />
              )}
              {agenda.next_cursor && limit < MAX_PAGE ? (
                <Link
                  href={withLimit(
                    agendaHref({ ...params, dia: agenda.day }),
                    Math.min(MAX_PAGE, limit + PAGE),
                  )}
                  scroll={false}
                  className="hover:bg-accent focus-visible:ring-ring mx-auto mt-4 w-fit rounded-full border px-4 py-1.5 text-sm outline-none focus-visible:ring-2"
                >
                  {ti.showMore}
                </Link>
              ) : null}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function Fallback() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-8 w-full" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default async function AgendaPage({ searchParams }: PageProps<'/[locale]/agenda'>) {
  const { locale, t } = await getI18n();
  const explore: TrailVisit = { path: '/', label: t.nav.explore.title, kind: 'explorar' };
  return (
    <>
      <PageHeader
        title={t.nav.explore.index.agendaTitle}
        kind="agenda"
        parents={[explore]}
        api={exploreAgendaRequest(locale)}
      />
      <Suspense fallback={<Fallback />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
