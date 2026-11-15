import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.live };
}

/** Ajustes → Produtos → Ao vivo: os 6 ajustes do ao vivo (saía de Operação). (#1069) */
export default function Page() {
  return <OpsViewPage view="live" />;
}
