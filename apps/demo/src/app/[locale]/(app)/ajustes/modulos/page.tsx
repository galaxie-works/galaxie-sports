import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.modules };
}

/** Ajustes → Dados → Módulos por esporte: o liga/desliga de cada módulo de dados por esporte e tier (docs/03 §11.6). */
export default function Page() {
  return <OpsViewPage view="modules" />;
}
