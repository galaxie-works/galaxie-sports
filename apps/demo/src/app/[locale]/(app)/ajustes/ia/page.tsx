import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.ai };
}

/** Ajustes → Inteligência → IA interna: política, provedor e todos os modelos de IA (A3); as chaves ficam em Credenciais. (#1069) */
export default function Page() {
  return <OpsViewPage view="ai" />;
}
