import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.meta.title };
}

/**
 * Ajustes → Plataforma → Sistema (#1001): logos, sugestões, Cosmos AI e histórico, empilhados. Os links de antes
 * (`?aba=status`, `?aba=ai`…) vão para a área nova de cada aba.
 */
export default function SystemPage({ searchParams }: PageProps<'/[locale]/ajustes/sistema'>) {
  return <OpsViewPage view="system" active="system" redirectFrom={searchParams} />;
}
