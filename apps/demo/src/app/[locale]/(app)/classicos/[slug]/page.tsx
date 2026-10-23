import type { Derby } from '@galaxie/contracts';
import { BookOpen, CalendarDays, Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Intensity } from '@/components/sport/intensity';
import { Section } from '@/components/sport/section';
import { SourceNote } from '@/components/sport/source-note';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { derbyRequest, getDerby, getTeamOverview } from '@/lib/galaxie/api';
import { apiLocale, contentLocale } from '@/lib/i18n/config';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { sportParent } from '@/lib/navigation';

type Match = Derby['retrospect']['last_5'][number];

/** Um confronto do retrospecto; `date` já vem formatada (idioma e fuso de quem vê). */
function MatchRow({ m, date }: { m: Match; date: string }) {
  return (
    <Link
      href={`/eventos/${m.event_id}`}
      className="hover:bg-accent -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
    >
      <span className="text-muted-foreground w-16 shrink-0 text-xs">{date}</span>
      <span className="flex-1 truncate text-right">{m.home.name}</span>
      <span className="shrink-0 font-semibold tabular-nums">
        {m.home.score} – {m.away.score}
      </span>
      <span className="flex-1 truncate">{m.away.name}</span>
      {m.competition ? (
        <span className="text-muted-foreground hidden w-40 truncate text-xs md:block">
          {m.competition.name}
        </span>
      ) : null}
    </Link>
  );
}

async function Content({ params }: { params: PageProps<'/[locale]/classicos/[slug]'>['params'] }) {
  const { slug } = await params;
  const { locale, t } = await getI18n();
  const td = t.pages.derby;
  const [first, f] = await Promise.all([getDerby(slug, locale), getFormatters()]);
  // história e apelidos na voz do país do clássico (Superclásico em es-AR, Clásico de Chile em es-CL)
  const content = contentLocale(locale, first.teams[0]?.country);
  const derby = content === apiLocale(locale) ? first : await getDerby(slug, content);
  const logos = await Promise.all(
    derby.teams.map(async (team) =>
      team.participant_id ? (await getTeamOverview(team.participant_id, locale)).team.logo : null,
    ),
  );
  const r = derby.retrospect;
  const all = derby.all_time;
  // em destaque, o histórico geral curado; sem ele, o recorte da base (sempre com o ano de início)
  const statsOf = (s: string) => (all ?? r).teams.find((team) => team.slug === s);
  const ourData = r.available && r.matches > 0 && r.since !== null;
  const nameOf = (s: string) => derby.teams.find((team) => team.slug === s)?.name ?? s;
  const api = derbyRequest(slug, locale, content);
  // os clássicos da base semântica são de futebol
  const sport = sportParent('football', t);

  return (
    <>
      <PageHeader title={derby.name} kind="clássico" parents={sport ? [sport] : undefined} api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-5">
            <div className="flex flex-col items-center gap-1 text-center">
              <h1 className="text-3xl font-semibold tracking-tight">{derby.name}</h1>
              <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-2 text-sm">
                <Badge variant="warning-light">{td.scopes[derby.scope] ?? derby.scope}</Badge>
                <Intensity value={derby.intensity} />
                {derby.aliases.length ? (
                  <span>· {fill(td.alsoKnownAs, { names: derby.aliases.join(', ') })}</span>
                ) : null}
              </div>
            </div>
            <div className="flex w-full max-w-2xl items-center justify-between gap-4">
              {derby.teams.map((team, i) => {
                const stats = statsOf(team.slug);
                const body = (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Crest src={logos[i]} name={team.name} size="lg" />
                    <span className="font-semibold">{team.name}</span>
                    {(all || ourData) && stats ? (
                      <span className="text-muted-foreground text-xs">
                        {stats.goals === null
                          ? plural(locale, stats.wins, td.wins)
                          : fill(td.teamStats, {
                              wins: plural(locale, stats.wins, td.wins),
                              goals: plural(locale, stats.goals, td.goals),
                            })}
                      </span>
                    ) : null}
                  </div>
                );
                return team.participant_id ? (
                  <Link
                    key={team.slug}
                    href={`/times/${team.participant_id}`}
                    className="flex-1 hover:opacity-90"
                  >
                    {body}
                  </Link>
                ) : (
                  <div key={team.slug} className="flex-1">
                    {body}
                  </div>
                );
              })}
            </div>
            {all ? (
              <div className="flex flex-col items-center gap-0.5 text-center">
                <p className="text-sm font-medium">
                  {td.allTime}:{' '}
                  {fill(td.record, {
                    matches: plural(locale, all.matches, td.matches),
                    draws: plural(locale, all.draws, td.draws),
                  })}
                  {all.basis === 'official' ? ` (${td.officialOnly})` : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  <SourceNote template={td.allTimeNote} date={f.calendarDate(all.as_of)} urls={all.sources} />
                </p>
              </div>
            ) : null}
            {ourData ? (
              <p className="text-muted-foreground text-center text-xs">
                {fill(td.ourData, { year: r.since! })}:{' '}
                {fill(td.record, {
                  matches: plural(locale, r.matches, td.matches),
                  draws: plural(locale, r.draws, td.draws),
                })}
                {all
                  ? ` · ${fill(td.ourDataWins, {
                      home: nameOf(r.teams[0]!.slug),
                      a: r.teams[0]!.wins,
                      b: r.teams[1]!.wins,
                      away: nameOf(r.teams[1]!.slug),
                    })}`
                  : null}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {r.last_5.length ? (
              <Section title={td.lastMatches} api={api}>
                <Card size="sm">
                  <CardContent className="flex flex-col">
                    {r.last_5.map((m) => (
                      <MatchRow key={m.event_id} m={m} date={f.shortDate(m.starts_at)} />
                    ))}
                  </CardContent>
                </Card>
              </Section>
            ) : null}
            {r.biggest_wins.length ? (
              <Section title={td.biggestWins} api={api}>
                <Card size="sm">
                  <CardContent className="flex flex-col">
                    {r.biggest_wins.map((m) => (
                      <MatchRow key={m.event_id} m={m} date={f.shortDate(m.starts_at)} />
                    ))}
                  </CardContent>
                </Card>
              </Section>
            ) : null}
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{td.history}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                {derby.first_match ? (
                  <p className="flex gap-2">
                    <CalendarDays className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                    {fill(td.firstMatch, { date: f.calendarDate(derby.first_match) })}
                  </p>
                ) : null}
                {derby.origin ? (
                  <p className="flex gap-2">
                    <BookOpen className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                    {derby.origin}
                  </p>
                ) : null}
                {derby.trivia.map((fact) => (
                  <p key={fact} className="text-muted-foreground flex gap-2">
                    <Lightbulb className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                    {fact}
                  </p>
                ))}
                {derby.next_event ? (
                  <Link
                    href={`/eventos/${derby.next_event.event_id}`}
                    className="text-primary hover:underline"
                  >
                    {fill(td.nextDerby, { date: f.dateTime(derby.next_event.starts_at) })}
                  </Link>
                ) : null}
                {Object.keys(derby.labels).length ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-xs">{td.labelsByMarket}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(derby.labels).map(([market, label]) => (
                        <Badge key={market} variant="outline">
                          <span className="text-muted-foreground font-mono">{market}</span> {label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {fill(td.reviewStatus, {
                    status: td.reviewStatuses[derby.review_status] ?? derby.review_status,
                  })}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

export default function DerbyPage({ params }: PageProps<'/[locale]/classicos/[slug]'>) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="p-4 md:p-6">
            <Skeleton className="h-64" />
          </div>
        </>
      }
    >
      <Content params={params} />
    </Suspense>
  );
}
