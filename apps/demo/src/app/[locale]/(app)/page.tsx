import type { ExploreSummary } from '@galaxie/contracts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { CountryCard, CountryRow } from '@/components/explore/country-card';
import { ExploreSkeleton } from '@/components/explore/explore-skeleton';
import { CONFEDERATIONS, COUNTRY_GRID, FEATURED_SPORT_SPAN, SPORT_GRID } from '@/components/explore/layout';
import { LivePill, MultisportCard, SportCard } from '@/components/explore/sport-card';
import { LiveDot } from '@/components/live/live-nav-item';
import { Section } from '@/components/sport/section';
import { exploreSummaryRequest, getExploreSummary } from '@/lib/galaxie/api';
import { compactNumber, countryLayout, FEATURED_SPORT } from '@/lib/explore';
import { EXPLORE_LINKS, exploreTotals } from '@/lib/explore-index';
import { defaultMarket, type Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { plural } from '@/lib/i18n/text';
import { COUNTRIES, MULTISPORT_NAV, SPORTS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Faixa de abertura: o tamanho da cobertura em números (esportes, países, jogos da semana, ao vivo). Cada
 * número é um card que abre a página dele (índice de esportes, de países, agenda e ao vivo), que conta a
 * mesma coisa com a mesma consulta (`exploreTotals`).
 */
function Totals({ summary, t, locale }: { summary: ExploreSummary | null; t: Dictionary; locale: Locale }) {
  const te = t.nav.explore;
  const totals = exploreTotals(summary);
  const tiles = [
    {
      href: EXPLORE_LINKS.sports,
      value: totals.sports,
      label: plural(locale, totals.sports, te.totals.sports),
    },
    {
      href: EXPLORE_LINKS.countries,
      value: totals.countries,
      label: plural(locale, totals.countries, te.totals.countries),
    },
    ...(totals.upcoming === null
      ? []
      : [
          {
            href: EXPLORE_LINKS.upcoming,
            value: totals.upcoming,
            label: plural(locale, totals.upcoming, te.totals.upcoming),
          },
        ]),
    ...(totals.live === null
      ? []
      : [{ href: EXPLORE_LINKS.live, value: totals.live, label: te.totals.live, live: true }]),
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{te.intro}</p>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <Link
              href={tile.href}
              className="tile-card group/tile focus-visible:ring-ring flex h-full flex-col gap-0.5 rounded-xl border px-4 py-3 outline-none focus-visible:ring-2"
            >
              <span
                className={cn(
                  'flex items-center gap-2 text-2xl font-semibold tracking-tight tabular-nums md:text-3xl',
                  'live' in tile && tile.value > 0 && 'text-live',
                )}
              >
                {'live' in tile ? <LiveDot on={tile.value > 0} /> : null}
                {compactNumber(locale, tile.value)}
              </span>
              <span className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                {tile.label}
                <ChevronRight
                  aria-hidden
                  className="size-3.5 shrink-0 opacity-50 transition-transform group-hover/tile:translate-x-0.5 group-hover/tile:opacity-100"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Content() {
  const [{ locale, t }, f] = await Promise.all([getI18n(), getFormatters()]);
  const te = t.nav.explore;
  const api = exploreSummaryRequest(locale);
  // sem a API, a home ainda navega: os cards aparecem sem os contadores
  const summary = await getExploreSummary(locale).catch(() => null);
  const sportData = new Map(summary?.sports.map((s) => [s.slug, s]));
  const countryData = new Map(summary?.countries.map((c) => [c.code, c]));

  return (
    <div className="flex flex-col gap-10 p-4 md:p-6">
      <Totals summary={summary} t={t} locale={locale} />

      <Section title={te.sports} description={te.sportsDescription} api={api}>
        <div className={SPORT_GRID}>
          {SPORTS.map((s) => (
            <SportCard
              key={s.slug}
              sport={s}
              label={t.nav.sports[s.slug]}
              data={sportData.get(s.slug)}
              featured={s.slug === FEATURED_SPORT}
              className={s.slug === FEATURED_SPORT ? FEATURED_SPORT_SPAN : undefined}
              t={te}
              locale={locale}
            />
          ))}
          <MultisportCard item={MULTISPORT_NAV} label={t.nav.multisport} description={te.multisportCard} />
        </div>
      </Section>

      <Section title={te.countries} description={te.countriesDescription} api={api}>
        <div className="flex flex-col gap-8">
          {CONFEDERATIONS.map((group) => {
            const countries = COUNTRIES.filter((c) => c.group === group);
            const data = countries.map((c) => countryData.get(c.code));
            const upcoming = data.reduce((n, d) => n + (d?.upcoming ?? 0), 0);
            const live = data.reduce((n, d) => n + (d?.live ?? 0), 0);
            const header = (
              <>
                <h3 className="flex items-baseline gap-2">
                  <span className="text-base font-semibold tracking-wide">{group}</span>
                  <span className="text-muted-foreground text-sm font-medium">{t.nav.groups[group]}</span>
                </h3>
                <span className="text-muted-foreground flex items-center gap-3 text-xs">
                  {plural(locale, countries.length, te.countriesCount)}
                  {summary ? ` · ${plural(locale, upcoming, te.upcomingCount)}` : null}
                  <LivePill count={live} t={te} />
                </span>
              </>
            );
            return (
              <div key={group} className="flex flex-col gap-3">
                {/* celular: uma linha por país, e só a América do Sul aberta (as outras, um toque) */}
                <details className="group/conf sm:hidden" open={group === CONFEDERATIONS[0]}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b pb-2.5 [&::-webkit-details-marker]:hidden">
                    {header}
                    <ChevronDown
                      className="text-muted-foreground size-4 transition-transform group-open/conf:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <ul className="tile-card mt-3 divide-y overflow-hidden rounded-xl border">
                    {countries.map((c) => (
                      <CountryRow
                        key={c.code}
                        country={c}
                        name={t.nav.countries[c.code]}
                        data={countryData.get(c.code)}
                        t={t}
                        locale={locale}
                      />
                    ))}
                  </ul>
                </details>
                <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b pb-2.5 max-sm:hidden">
                  {header}
                </div>
                <div className={cn(COUNTRY_GRID, 'max-sm:hidden')}>
                  {countryLayout(
                    countries.map((c) => c.code),
                    defaultMarket(locale),
                  ).map(({ code, wide }) => (
                    <CountryCard
                      key={code}
                      country={countries.find((c) => c.code === code)!}
                      name={t.nav.countries[code]}
                      data={countryData.get(code)}
                      wide={wide}
                      t={t}
                      locale={locale}
                      f={f}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

/** Ponto de entrada da demo: esportes e países com os metadados reais de `/v1/explore/summary`. */
export default async function ExplorePage() {
  const { locale, t } = await getI18n();
  return (
    <>
      <PageHeader title={t.nav.explore.title} kind="explorar" api={exploreSummaryRequest(locale)} />
      {/* contadores e horários dependem da requisição (fuso do navegador): atrás de Suspense */}
      <Suspense fallback={<ExploreSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}
