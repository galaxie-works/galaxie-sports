import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.cosmos };
}

/** Ajustes → Inteligência → Cosmos AI (saía de Sistema). (#1069) */
export default function Page() {
  return <OpsViewPage view="cosmos" />;
}
