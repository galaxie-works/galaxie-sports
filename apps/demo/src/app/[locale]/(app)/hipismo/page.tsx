import type { EqAthleteSummary } from '@galaxie/contracts';
import { Award, BookOpenCheck, Search, Trophy, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Flag, HistoryBadge, NoticeBanner } from '@/components/equestrian/parts';
import { RankingsTable } from '@/components/equestrian/rankings-table';
import { Badge } from '@/components/reui/badge';
import { AnimatedSportIcon } from '@/components/sport/animated-sport-icon';
import { Section } from '@/components/sport/section';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { equestrianOverviewRequest, getEquestrianOverview } from '@/lib/galaxie/equestrian';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getFormatters, getI18n, getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).equestrian.title };
}

type T = Dictionary['equestrian'];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

function AthleteCard({ a, t, featured }: { a: EqAthleteSummary; t: T; featured: boolean }) {
  return (
    <Link href={`/hipismo/atletas/${a.id}`} className="group/entry">
      <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Flag country={a.country} className="h-4 w-6" />
            <span className="truncate font-medium">{a.name}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {featured ? <Badge variant="primary-light">{t.highlights.featured}</Badge> : null}
            <HistoryBadge coverage={a.history_coverage} t={t} />
          </div>
          <span className="text-muted-foreground text-xs">
            {fill(t.highlights.results, { n: a.results })} · {fill(t.highlights.wins, { n: a.wins })}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

async function Content() {
  const { locale, t } = await getI18n();
  const te = t.equestrian;
  // fuso do cookie primeiro: a página fica dinâmica e o build não chama a API (mesmo padrão da home)
  const f = await getFormatters();
  const o = await getEquestrianOverview(locale);
  const api = equestrianOverviewRequest(locale);
  const cov = o.coverage;
  const athletesTotal = cov.athletes.complete + cov.athletes.partial + cov.athletes.not_collected;
  const featuredIds = new Set(o.highlights.slice(0, 1).map((h) => h.id));
  return (
    <div className="flex flex-col gap-8 p-4 md:p-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <AnimatedSportIcon slug="equestrian" className="size-10">
            <Trophy />
          </AnimatedSportIcon>
          <div className="flex flex-col">
            <h1 className="text-2xl font-semibold tracking-tight">{te.title}</h1>
            <p className="text-muted-foreground max-w-3xl text-sm">{te.intro}</p>
          </div>
        </div>
        <NoticeBanner notice={o.notice} t={te} />
      </div>

      <Section
        title={te.highlights.title}
        description={te.highlights.description}
        icon={<Award className="size-4" />}
        api={api}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {o.highlights.map((a) => (
            <AthleteCard key={a.id} a={a} t={te} featured={featuredIds.has(a.id)} />
          ))}
        </div>
      </Section>

      <Section
        title={te.athletes.title}
        description={te.athletes.description}
        icon={<Search className="size-4" />}
      >
        <form action="/hipismo/atletas" className="flex max-w-xl gap-2">
          <Input name="q" placeholder={te.athletes.search} aria-label={te.athletes.search} />
          <Button type="submit">{te.athletes.apply}</Button>
        </form>
      </Section>

      <Section title={te.recent.title} description={te.recent.description} api={api}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {o.recent_competitions.map((c) => (
            <Link key={c.id} href={`/hipismo/provas/${c.id}`} className="group/entry">
              <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
                <CardContent className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Flag country={c.country} />
                    <span className="truncate font-medium">{c.name}</span>
                  </div>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                    {c.date ? <span>{f.calendarDate(c.date)}</span> : null}
                    {c.venue ? <span>· {c.venue}</span> : null}
                    {c.level ? <Badge variant="outline">{c.level}</Badge> : null}
                    {c.height_cm ? <span>{c.height_cm} cm</span> : null}
                    {c.is_grand_prix ? <Badge variant="primary-light">{te.competition.gp}</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={c.all_entries_observed ? 'success-light' : 'warning-light'}>
                      {c.all_entries_observed ? te.recent.full : te.recent.partial}
                    </Badge>
                    <Badge variant="secondary">{fill(te.recent.latam, { n: c.latam_entries })}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        title={te.championships.title}
        description={te.championships.description}
        icon={<BookOpenCheck className="size-4" />}
        api={api}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {o.championships.map((c) => (
            <Link key={c.key} href={`/hipismo/campeonatos/${c.key}`} className="group/entry">
              <Card size="sm" className="group-hover/entry:bg-accent h-full transition-colors">
                <CardContent className="flex flex-col gap-1">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {c.start ? f.calendarDate(c.start) : null} ·{' '}
                    {fill(te.championships.rounds, { n: c.rounds })}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        title={te.coverage.title}
        description={te.coverage.description}
        icon={<Users className="size-4" />}
        api={api}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat
            label={te.coverage.athletes}
            value={f.number(athletesTotal)}
            hint={`${f.number(cov.athletes.complete)} · ${te.history.complete.toLowerCase()}`}
          />
          <Stat label={te.coverage.results} value={f.number(cov.results)} />
          <Stat
            label={te.coverage.horses}
            value={f.number(cov.horses.detailed + cov.horses.pending)}
            hint={fill(te.coverage.horsesDetailed, { n: f.number(cov.horses.detailed) })}
          />
          <Stat
            label={te.coverage.competitions}
            value={f.number(cov.competitions.total)}
            hint={fill(te.coverage.fullStandings, { n: f.number(cov.competitions.full_standings) })}
          />
          <Stat label={te.coverage.rounds} value={f.number(cov.rounds)} />
        </div>
        <p className="text-muted-foreground text-xs">{cov.note}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cov.by_country.map((c) => (
            <Card key={c.country.code} size="sm">
              <CardContent className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-medium">
                  <Flag country={c.country} className="h-4 w-6" />
                  {c.country.name ?? c.country.code}
                </span>
                <span className="text-muted-foreground text-xs">
                  {f.number(c.athletes)} {te.coverage.athletes.toLowerCase()} · {f.number(c.results)}{' '}
                  {te.coverage.results.toLowerCase()}
                </span>
                {c.first && c.last ? (
                  <span className="text-muted-foreground text-xs">
                    {fill(te.coverage.period, { from: c.first.slice(0, 4), to: c.last.slice(0, 4) })}
                  </span>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {o.rankings.length ? (
        <Section title={te.rankings.title} description={te.rankings.description} api={api}>
          <RankingsTable rows={o.rankings} t={te} f={f} />
        </Section>
      ) : null}
    </div>
  );
}

export default async function EquestrianPage() {
  const { locale, t } = await getI18n();
  return (
    <>
      <PageHeader title={t.equestrian.title} kind="esporte" api={equestrianOverviewRequest(locale)} />
      <Suspense
        fallback={
          <div className="flex flex-col gap-4 p-4 md:p-6">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          </div>
        }
      >
        <Content />
      </Suspense>
    </>
  );
}
