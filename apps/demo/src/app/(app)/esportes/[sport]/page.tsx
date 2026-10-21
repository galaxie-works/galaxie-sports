import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/app-shell/empty-state';
import { PageHeader } from '@/components/app-shell/page-header';
import { SPORTS, sportBySlug } from '@/lib/navigation';

export function generateStaticParams() {
  return SPORTS.map((s) => ({ sport: s.slug }));
}

export default async function SportPage({ params }: PageProps<'/esportes/[sport]'>) {
  const { sport: slug } = await params;
  const sport = sportBySlug(slug);
  if (!sport) notFound();

  return (
    <>
      <PageHeader title={sport.label} />
      <EmptyState
        title={`Sem eventos de ${sport.label.toLowerCase()} por enquanto`}
        description="Este esporte ainda não tem competições sincronizadas. Avisaremos quando houver novidade."
      />
    </>
  );
}
