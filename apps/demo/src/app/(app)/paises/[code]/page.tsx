import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { COUNTRIES, countryByCode } from '@/lib/navigation';

export function generateStaticParams() {
  return COUNTRIES.map((c) => ({ code: c.code.toLowerCase() }));
}

export default async function CountryPage({ params }: PageProps<'/paises/[code]'>) {
  const { code } = await params;
  const country = countryByCode(code);
  if (!country) notFound();

  return (
    <>
      <PageHeader title={country.label} />
      <EmptyState
        title="Competições do país"
        description="Ligas nacionais, torneios continentais e seleções entram aqui."
      />
    </>
  );
}
