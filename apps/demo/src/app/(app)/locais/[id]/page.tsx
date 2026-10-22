import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getVenue, venueRequest } from '@/lib/galaxie/api';

const SURFACE_LABEL: Record<string, string> = {
  grass: 'Grama natural',
  'artificial turf': 'Grama sintética',
  artificial: 'Grama sintética',
  hybrid: 'Grama híbrida',
};

/** "2026-05-03" → "03/05/2026" (sem passar por Date, para não depender do fuso). */
const isoDayToBr = (iso: string) => iso.split('-').reverse().join('/');

async function Content({ params }: { params: PageProps<'/locais/[id]'>['params'] }) {
  const { id } = await params;
  const venue = await getVenue(id);
  // só nomes anteriores confirmados pela curadoria; os derivados do fornecedor são pistas e ficam fora da tela
  const formerNames = venue.former_names.filter((f) => f.origin === 'curated');
  const facts = [
    venue.city ? ['Cidade', venue.city] : null,
    venue.capacity ? ['Capacidade', `${venue.capacity.toLocaleString('pt-BR')} lugares`] : null,
    venue.surface ? ['Gramado', SURFACE_LABEL[venue.surface.toLowerCase()] ?? venue.surface] : null,
  ].filter((f): f is [string, string] => f !== null);

  return (
    <>
      <PageHeader title={venue.name} kind="local" api={venueRequest(id)} />
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
            <h2 className="text-muted-foreground text-xs">Nomes anteriores</h2>
            <ul className="flex flex-col gap-0.5 text-sm">
              {formerNames.map((f) => (
                <li key={`${f.name}-${f.until}`}>
                  <span className="font-medium">{f.name}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    ({f.from ? `${isoDayToBr(f.from)} a ` : 'até '}
                    {isoDayToBr(f.until)})
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

export default function VenuePage({ params }: PageProps<'/locais/[id]'>) {
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
