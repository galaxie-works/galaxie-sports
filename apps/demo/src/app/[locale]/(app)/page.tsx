import type { ExploreSummary } from '@galaxie/contracts';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { CountryCard } from '@/components/explore/country-card';
import { ExploreSkeleton } from '@/components/explore/explore-skeleton';
import { CONFEDERATIONS, COUNTRY_GRID, FEATURED_SPORT_SPAN, SPORT_GRID } from '@/components/explore/layout';
import { LivePill, MultisportCard, SportCard } from '@/components/explore/sport-card';
import { LiveDot } from '@/components/live/live-nav-item';
import { Section } from '@/components/sport/section';
import { exploreSummaryRequest, getExploreSummary } from '@/lib/galaxie/api';
import { compactNumber, countryLayout, FEATURED_SPORT } from '@/lib/explore';
import { defaultMarket, type Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { plural } from '@/lib/i18n/text';
import { COUNTRIES, MULTISPORT_NAV, SPORTS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/** Faixa de abertura: o tamanho da cobertura em números (esportes, países, jogos da semana, ao vivo). */
function Totals({ summary, t, locale }: { summary: ExploreSummary | null; t: Dictionary; locale: Locale }) {
  const te = t.nav.explore;
  const upcoming = summary?.sports.reduce((n, s) => n + s.upcoming, 0) ?? null;
  const live = summary?.sports.reduce((n, s) => n + s.live, 0) ?? null;
  const tiles = [
    { value: SPORTS.length, label: plural(locale, SPORTS.length, te.totals.sports) },
    { value: COUNTRIES.length, label: plural(locale, COUNTRIES.length, te.totals.countries) },
    ...(upcoming === null ? [] : [{ value: upcoming, label: plural(locale, upcoming, te.totals.upcoming) }]),
    ...(live === null ? [] : [{ value: live, label: te.totals.live, live: true }]),
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{te.intro}</p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="explore-card flex flex-col-reverse justify-end gap-0.5 rounded-xl border px-4 py-3"
          >
            <dt className="text-muted-foreground text-xs">{tile.label}</dt>
            <dd
              className={cn(
                'flex items-center gap-2 text-2xl font-semibold tracking-tight tabular-nums md:text-3xl',
                'live' in tile && tile.value > 0 && 'text-live',
              )}
            >
              {'live' in tile ? <LiveDot on={tile.value > 0} /> : null}
              {compactNumber(locale, tile.value)}
            </dd>
          </div>
        ))}
      </dl>
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
            return (
              <div key={group} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b pb-2.5">
                  <h3 className="flex items-center gap-3">
                    <span className="bg-primary h-6 w-1 rounded-full" aria-hidden />
                    <span className="text-lg font-bold tracking-[0.14em]">{group}</span>
                    <span className="text-muted-foreground text-sm font-medium">{t.nav.groups[group]}</span>
                  </h3>
                  <span className="text-muted-foreground flex items-center gap-3 text-xs">
                    {plural(locale, countries.length, te.countriesCount)}
                    {summary ? ` · ${plural(locale, upcoming, te.upcomingCount)}` : null}
                    <LivePill count={live} t={te} />
                  </span>
                </div>
                <div className={COUNTRY_GRID}>
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
