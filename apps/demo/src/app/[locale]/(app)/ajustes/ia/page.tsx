import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.ai };
}

/** Ajustes → Plataforma → IA interna (#1001): as seções dela empilhadas, sem abas. */
export default function Page() {
  return <OpsViewPage view="ai" active="ai" />;
}
