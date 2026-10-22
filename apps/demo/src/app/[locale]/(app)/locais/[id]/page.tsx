import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getVenue, venueRequest } from '@/lib/galaxie/api';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';

/** Gramado como vem da API (texto livre do provedor) → chave do dicionário. */
const SURFACE_KEY: Record<string, 'grass' | 'artificial' | 'hybrid'> = {
  grass: 'grass',
  'artificial turf': 'artificial',
  artificial: 'artificial',
  hybrid: 'hybrid',
};

async function Content({ params }: { params: PageProps<'/[locale]/locais/[id]'>['params'] }) {
  const { id } = await params;
  const { locale, t } = await getI18n();
  const tv = t.pages.venue;
  const [venue, f] = await Promise.all([getVenue(id, locale), getFormatters()]);
  const surface = venue.surface ? SURFACE_KEY[venue.surface.toLowerCase()] : undefined;
  // só nomes anteriores confirmados pela curadoria; os derivados do fornecedor são pistas e ficam fora da tela
  const formerNames = venue.former_names.filter((n) => n.origin === 'curated');
  const facts = [
    venue.city ? [tv.city, venue.city] : null,
    venue.capacity
      ? [tv.capacity, plural(locale, venue.capacity, tv.seats, { count: f.number(venue.capacity) })]
      : null,
    venue.surface ? [tv.surface, surface ? tv.surfaces[surface] : venue.surface] : null,
  ].filter((f): f is [string, string] => f !== null);

  return (
    <>
      <PageHeader title={venue.name} kind="local" api={venueRequest(id, locale)} />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {venue.image ? (
          <Card className="py-0">
            {/* Foto do estádio vinda do espelho de mídia (S3); não passa pelo otimizador do Next. */}
            <img src={venue.image} alt={venue.name} className="h-64 w-full object-cover" />
          </Card>
        ) : null}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{venue.name}</h1>
          {venue.country ? (
            <Link
              href={`/paises/${venue.country.code.toLowerCase()}`}
              className="text-muted-foreground text-sm hover:underline"
            >
              {venue.country.name}
            </Link>
          ) : null}
        </div>
        {formerNames.length ? (
          <div className="flex flex-col gap-1">
            <h2 className="text-muted-foreground text-xs">{tv.formerNames}</h2>
            <ul className="flex flex-col gap-0.5 text-sm">
              {formerNames.map((n) => (
                <li key={`${n.name}-${n.until}`}>
                  <span className="font-medium">{n.name}</span>{' '}
                  <span className="text-muted-foreground">
                    (
                    {n.from
                      ? fill(tv.formerRange, { from: f.calendarDate(n.from), until: f.calendarDate(n.until) })
                      : fill(tv.formerUntil, { until: f.calendarDate(n.until) })}
                    )
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {facts.length ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">{k}</dt>
                <dd className="text-sm font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </>
  );
}

export default function VenuePage({ params }: PageProps<'/[locale]/locais/[id]'>) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="p-4 md:p-6">
            <Skeleton className="aspect-[21/9] w-full" />
          </div>
        </>
      }
    >
      <Content params={params} />
    </Suspense>
  );
}
