import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.postgame };
}

/** Ajustes → Produtos → Pós-jogo: os 23 ajustes do pós-jogo (saía do Ao vivo). (#1069) */
export default function Page() {
  return <OpsViewPage view="postgame" />;
}
