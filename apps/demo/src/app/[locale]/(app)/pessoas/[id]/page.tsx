import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getPerson, personRequest } from '@/lib/galaxie/api';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';

async function Content({ params }: { params: PageProps<'/[locale]/pessoas/[id]'>['params'] }) {
  const { id } = await params;
  const { locale, t } = await getI18n();
  const tp = t.pages.person;
  const [person, f] = await Promise.all([getPerson(id, locale), getFormatters()]);
  const age = person.age ? plural(locale, person.age, tp.years) : null;
  const facts = [
    person.nationality ? [tp.nationality, person.nationality] : null,
    person.birth_date
      ? [
          tp.birth,
          age
            ? fill(tp.birthWithAge, { date: f.calendarDate(person.birth_date), age })
            : f.calendarDate(person.birth_date),
        ]
      : age
        ? [tp.age, age]
        : null,
    person.height_cm ? [tp.height, `${f.number(person.height_cm)} cm`] : null,
    person.weight_kg ? [tp.weight, `${f.number(person.weight_kg)} kg`] : null,
  ].filter((f): f is [string, string] => f !== null);

  return (
    <>
      <PageHeader title={person.name} kind="pessoa" api={personRequest(id, locale)} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex items-center gap-4">
          <Crest src={person.photo} name={person.name} size="xl" round />
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{person.name}</h1>
            {person.first_name || person.last_name ? (
              <span className="text-muted-foreground text-sm">
                {[person.first_name, person.last_name].filter(Boolean).join(' ')}
              </span>
            ) : null}
          </div>
        </div>

        {facts.length ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">{k}</dt>
                <dd className="text-sm font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {person.teams.length ? (
          <Section title={tp.teams} api={personRequest(id, locale)}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {person.teams.map((m) => (
                <Link
                  key={`${m.team.id}-${m.season}-${m.role}`}
                  href={`/times/${m.team.id}`}
                  className="group/entry"
                >
                  <Card size="sm" className="group-hover/entry:bg-accent transition-colors">
                    <CardContent className="flex items-center gap-3">
                      <Crest src={m.team.logo} name={m.team.name} size="md" />
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-medium">{m.team.name}</span>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary">{tp.roles[m.role] ?? m.role}</Badge>
                          {m.position ? (
                            <Badge variant="outline">
                              {tp.positions[m.position] ?? t.sport.positions[m.position] ?? m.position}
                            </Badge>
                          ) : null}
                          {m.number ? <Badge variant="outline">#{m.number}</Badge> : null}
                          <Badge variant="outline">{m.season ?? tp.currentSquad}</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </>
  );
}

export default function PersonPage({ params }: PageProps<'/[locale]/pessoas/[id]'>) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="flex items-center gap-4 p-4 md:p-6">
            <Skeleton className="size-24 rounded-full" />
            <Skeleton className="h-7 w-48" />
          </div>
        </>
      }
    >
      <Content params={params} />
    </Suspense>
  );
}
