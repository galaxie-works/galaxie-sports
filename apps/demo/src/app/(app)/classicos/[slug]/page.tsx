import type { Derby } from '@galaxie/contracts';
import { BookOpen, CalendarDays, Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Intensity } from '@/components/sport/intensity';
import { Section } from '@/components/sport/section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtDateTime, fmtShortDate } from '@/lib/format';
import { derbyRequest, getDerby, getTeamOverview } from '@/lib/galaxie/api';

const SCOPE_LABEL: Record<string, string> = {
  city: 'Clássico local',
  state: 'Clássico estadual',
  national: 'Clássico nacional',
  continental: 'Clássico continental',
  international: 'Clássico internacional',
};

type Match = Derby['retrospect']['last_5'][number];

function MatchRow({ m }: { m: Match }) {
  return (
    <Link
      href={`/eventos/${m.event_id}`}
      className="hover:bg-accent -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
    >
      <span className="text-muted-foreground w-16 shrink-0 text-xs">{fmtShortDate(m.starts_at)}</span>
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

async function Content({ params }: { params: PageProps<'/classicos/[slug]'>['params'] }) {
  const { slug } = await params;
  const derby = await getDerby(slug);
  const logos = await Promise.all(
    derby.teams.map(async (t) =>
      t.participant_id ? (await getTeamOverview(t.participant_id)).team.logo : null,
    ),
  );
  const r = derby.retrospect;
  const winsOf = (s: string) => r.teams.find((t) => t.slug === s);
  const api = derbyRequest(slug);

  return (
    <>
      <PageHeader title={derby.name} kind="clássico" api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-5">
            <div className="flex flex-col items-center gap-1 text-center">
              <h1 className="text-3xl font-semibold tracking-tight">{derby.name}</h1>
              <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-2 text-sm">
                <Badge variant="warning-light">{SCOPE_LABEL[derby.scope] ?? derby.scope}</Badge>
                <Intensity value={derby.intensity} />
                {derby.aliases.length ? <span>· também chamado de {derby.aliases.join(', ')}</span> : null}
              </div>
            </div>
            <div className="flex w-full max-w-2xl items-center justify-between gap-4">
              {derby.teams.map((t, i) => {
                const stats = winsOf(t.slug);
                const body = (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Crest src={logos[i]} name={t.name} size="lg" />
                    <span className="font-semibold">{t.name}</span>
                    {r.available && stats ? (
                      <span className="text-muted-foreground text-xs">
                        {stats.wins} vitórias · {stats.goals} gols
                      </span>
                    ) : null}
                  </div>
                );
                return t.participant_id ? (
                  <Link key={t.slug} href={`/times/${t.participant_id}`} className="flex-1 hover:opacity-90">
                    {body}
                  </Link>
                ) : (
                  <div key={t.slug} className="flex-1">
                    {body}
                  </div>
                );
              })}
            </div>
            {r.available ? (
              <p className="text-muted-foreground text-sm">
                {r.matches} jogos na base · {r.draws} empates
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {r.last_5.length ? (
              <Section title="Últimos confrontos" api={api}>
                <Card size="sm">
                  <CardContent className="flex flex-col">
                    {r.last_5.map((m) => (
                      <MatchRow key={m.event_id} m={m} />
                    ))}
                  </CardContent>
                </Card>
              </Section>
            ) : null}
            {r.biggest_wins.length ? (
              <Section title="Maiores goleadas" api={api}>
                <Card size="sm">
                  <CardContent className="flex flex-col">
                    {r.biggest_wins.map((m) => (
                      <MatchRow key={m.event_id} m={m} />
                    ))}
                  </CardContent>
                </Card>
              </Section>
            ) : null}
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>História</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                {derby.first_match ? (
                  <p className="flex gap-2">
                    <CalendarDays className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                    Primeiro jogo em {new Date(`${derby.first_match}T12:00:00Z`).toLocaleDateString('pt-BR')}
                  </p>
                ) : null}
                {derby.origin ? (
                  <p className="flex gap-2">
                    <BookOpen className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                    {derby.origin}
                  </p>
                ) : null}
                {derby.trivia.map((t) => (
                  <p key={t} className="text-muted-foreground flex gap-2">
                    <Lightbulb className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                    {t}
                  </p>
                ))}
                {derby.next_event ? (
                  <Link
                    href={`/eventos/${derby.next_event.event_id}`}
                    className="text-primary hover:underline"
                  >
                    Próximo clássico: {fmtDateTime(derby.next_event.starts_at)}
                  </Link>
                ) : null}
                {Object.keys(derby.labels).length ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-xs">Nome por mercado</span>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(derby.labels).map(([locale, label]) => (
                        <Badge key={locale} variant="outline">
                          <span className="text-muted-foreground font-mono">{locale}</span> {label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="text-muted-foreground text-xs">Status editorial: {derby.review_status}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

export default function DerbyPage({ params }: PageProps<'/classicos/[slug]'>) {
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
