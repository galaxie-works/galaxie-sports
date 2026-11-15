import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.status };
}

/** Ajustes → Plataforma → Status dos serviços: serviços, crédito e gasto da IA, cota e jobs (saía de Operação). (#1069) */
export default function Page() {
  return <OpsViewPage view="status" />;
}
