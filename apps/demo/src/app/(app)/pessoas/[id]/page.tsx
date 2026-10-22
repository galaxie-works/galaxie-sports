import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { POSITION_LABEL } from '@/lib/format';
import { getPerson } from '@/lib/galaxie/api';

const ROLE_LABEL: Record<string, string> = { player: 'Jogador', coach: 'Técnico', staff: 'Comissão' };
/** Posição no singular (o rótulo do elenco é plural). */
const POSITION_SINGULAR: Record<string, string> = {
  Goalkeeper: 'Goleiro',
  Defender: 'Defensor',
  Midfielder: 'Meio-campista',
  Attacker: 'Atacante',
};

async function Content({ params }: { params: PageProps<'/pessoas/[id]'>['params'] }) {
  const { id } = await params;
  const person = await getPerson(id);
  const facts = [
    person.nationality ? ['Nacionalidade', person.nationality] : null,
    person.birth_date
      ? [
          'Nascimento',
          `${new Date(`${person.birth_date}T12:00:00Z`).toLocaleDateString('pt-BR')}${person.age ? ` (${person.age} anos)` : ''}`,
        ]
      : person.age
        ? ['Idade', `${person.age} anos`]
        : null,
    person.height_cm ? ['Altura', `${person.height_cm} cm`] : null,
    person.weight_kg ? ['Peso', `${person.weight_kg} kg`] : null,
  ].filter((f): f is [string, string] => f !== null);

  return (
    <>
      <PageHeader title={person.name} kind="pessoa" />
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
          <Section title="Times">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {person.teams.map((t) => (
                <Link
                  key={`${t.team.id}-${t.season}-${t.role}`}
                  href={`/times/${t.team.id}`}
                  className="group/entry"
                >
                  <Card size="sm" className="group-hover/entry:bg-accent transition-colors">
                    <CardContent className="flex items-center gap-3">
                      <Crest src={t.team.logo} name={t.team.name} size="md" />
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate font-medium">{t.team.name}</span>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary">{ROLE_LABEL[t.role] ?? t.role}</Badge>
                          {t.position ? (
                            <Badge variant="outline">
                              {POSITION_SINGULAR[t.position] ?? POSITION_LABEL[t.position] ?? t.position}
                            </Badge>
                          ) : null}
                          {t.number ? <Badge variant="outline">#{t.number}</Badge> : null}
                          <Badge variant="outline">{t.season ?? 'Elenco atual'}</Badge>
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

export default function PersonPage({ params }: PageProps<'/pessoas/[id]'>) {
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
